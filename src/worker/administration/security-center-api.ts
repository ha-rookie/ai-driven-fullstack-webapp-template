import { requireAuthenticatedUser, requireScopedAuthorization } from "../authorization";
import { apiErrorResponse } from "../http";
import { resolveWorkhubRuntimeEnvironment } from "../workhub-login";
import type { RuntimeEnvironment } from "../../shared/runtime";
import { readSecurityCenterSources, unconnectedSecuritySources, readSecurityCenterStep, SECURITY_WORKFLOWS, type SecurityCenterSource, type SecurityCenterSourceReader, type SecurityCenterStepReader } from "./security-center-source-reader";
import scsMapping from "../../../config/scs-control-mapping.json";
import { normalizeSecurityFinding, normalizeSecuritySourceCoverage } from "../../shared/security/security-finding";
import { readRuntimeOsvAdvisories, type RuntimeOsvReader, type RuntimeOsvResult } from "./security-osv-advisory-reader";

/** #420: bounded read-only, authenticated, scoped evidence-status projection.
 * This is NOT a scanner, Finding feed, SCS certification or audit verdict.
 */
const SCOPE = "workhub-company";
const ROUTE = "/api/admin/security/center";
const ACTION = "administration:manage";
const POLICY = { [ACTION]: ["system_admin"] };

interface Env { readonly DB: D1Database; readonly RUNTIME_ENVIRONMENT?: string }
const reject = (requestId: string, status: number, code: string): Response =>
  apiErrorResponse({ status, code, message: status === 401 ? "Authentication required"
    : status === 403 ? "Access denied" : status === 405 ? "Method not allowed"
      : status === 400 ? "Invalid Security Center query" : "Security Center unavailable" }, requestId);

export const projectSecurityCenter = (asOf: string, sources: readonly SecurityCenterSource[] = unconnectedSecuritySources(asOf)) => ({
  schemaVersion: 1 as const,
  scopeId: SCOPE,
  observedAt: asOf,
  posture: "not-assessed" as const,
  findings: { state: "not-connected" as const, items: null, verifiedCount: null },
  sources,
  scs: {
    sourceVerifiedAt: scsMapping.source.verifiedAt,
    certification: "not-assessed" as const,
    requirements: scsMapping.requirements.map(({ id, level, name, status, control, test, evidence }) => ({
      id, level, name, responsibility: status, control,
      testReference: test || null, evidenceReference: evidence || null,
      evidenceFreshness: "unknown" as const, finding: null, remediation: null,
    })),
  },
});

/**
 * A manually requested, narrowly verified feed of *CI control-step failures*.
 * It is never a vulnerability-scanner result or proof of zero vulnerabilities.
 * No failure/ambiguous/unavailable source is promoted to a checked zero.
 */
export const projectObservedCiControlFindings = async (
  sources: readonly SecurityCenterSource[], asOf: string, stepReader: SecurityCenterStepReader,
) => {
  const observed = await Promise.all(sources.map(async source => {
    const latest = source.ci.latest;
    if (source.ci.state !== "available" || !latest
      || latest.checkStatus !== "completed" || latest.checkConclusion !== "failure"
      || !source.ci.fetchedAt || Date.parse(asOf) - Date.parse(source.ci.fetchedAt) > 300_000) return null;
    const policy = SECURITY_WORKFLOWS.find(item => item.sourceId === source.sourceId);
    if (!policy) return null;
    const result = await stepReader(source, asOf);
    if (result.state !== "observed" || result.conclusion !== "failure"
      || result.sourceId !== source.sourceId || result.stepCode !== policy.stepCode
      || result.runId !== latest.runId || result.targetSha !== latest.targetSha
      || !result.controlFinding) return null;
    const category = source.sourceId === "dependency_audit" ? "dependency"
      : source.sourceId === "secret_detection" ? "data" : "configuration";
    const severity = source.sourceId === "secret_detection" || source.sourceId === "dependency_audit"
      ? "high" : "medium";
    const expected = normalizeSecurityFinding({
      ruleId: "ci_step_failure", category, severity, status: "open",
      resourceRef: "commit_" + latest.targetSha.slice(0, 12),
      detectedAt: latest.updatedAt, lastObservedAt: latest.updatedAt,
      evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "run_" + latest.runId }],
      remediationCode: "review_control",
    }, source.sourceId, asOf);
    // The source reader must not substitute raw logs, a different run, or forged data.
    return JSON.stringify(result.controlFinding) === JSON.stringify(expected)
      ? { sourceId: source.sourceId, finding: expected } : null;
  }));
  const actual = observed.filter((item): item is NonNullable<typeof item> => item !== null);
  if (actual.length === 0) return projectSecurityCenter(asOf, sources);
  const checkedSources = sources.map(source => actual.some(item => item.sourceId === source.sourceId)
    ? { ...normalizeSecuritySourceCoverage({
      sourceId: source.sourceId, coverageState: "checked", sourceHealth: "degraded",
      lastSuccessfulCheckAt: asOf,
      evidenceValidUntil: new Date(Date.parse(asOf) + 300_000).toISOString(),
      checkedFindingCount: 1,
    }, asOf), ci: source.ci } : source);
  return { ...projectSecurityCenter(asOf, checkedSources),
    findings: { state: "verified" as const, items: actual.map(item => item.finding),
      verifiedCount: actual.length } };
};


/** OSV advisories are real source IDs; their severity and remediation state are not known. */
export const projectRuntimeOsvFindings = (result: RuntimeOsvResult, asOf: string) => {
  const base = projectSecurityCenter(asOf);
  if (result.state !== "verified" || result.checkedPackages !== 12
    || result.checkedAt !== asOf || result.advisoryCount !== result.advisories.length) {
    return { ...base, dependencyScope: { state: "unavailable" as const, checkedPackages: null,
      checkedAt: null, advisoryCount: null, advisories: null } };
  }
  const items = result.advisories.map(advisory => normalizeSecurityFinding({
    ruleId: "osv_advisory", category: "dependency", severity: "info", status: "open",
    resourceRef: advisory.packageRef, detectedAt: asOf, lastObservedAt: asOf,
    evidence: [{ kind: "dependency", code: "dependency_alert" }],
    remediationCode: "update_dependency",
  }, "dependency_audit", asOf));
  return { ...base, dependencyScope: { state: "verified" as const,
    checkedPackages: 12, checkedAt: asOf, advisoryCount: items.length,
    advisories: result.advisories }, findings: {
      state: "verified" as const, items, verifiedCount: items.length,
    }, sources: base.sources.map(source => source.sourceId === "dependency_audit"
      ? { ...normalizeSecuritySourceCoverage({
        sourceId: source.sourceId, coverageState: "checked", sourceHealth: "ready",
        lastSuccessfulCheckAt: asOf, evidenceValidUntil: new Date(Date.parse(asOf) + 300_000).toISOString(),
        checkedFindingCount: items.length,
      }, asOf), ci: source.ci } : source) };
};

export const handleSecurityCenterApi = async (
  request: Request, env: Env, requestId: string,
  sourceReader: SecurityCenterSourceReader = readSecurityCenterSources,
  stepReader: SecurityCenterStepReader = readSecurityCenterStep,
  osvReader: RuntimeOsvReader = readRuntimeOsvAdvisories,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return null;
  if (request.method !== "GET") return reject(requestId, 405, "method_not_allowed");
  // Fixed read modes on one scoped API; callers cannot provide a run, SHA or URL.
  const details = url.searchParams.has("sourceId");
  const osvDetails = url.searchParams.has("dependencyAdvisories");
  const controlFindings = url.searchParams.has("controlFindings");
  const dependencyFindings = url.searchParams.has("dependencyFindings");
  const selectedSourceId = url.searchParams.get("sourceId");
  const selectedModes = Number(details) + Number(osvDetails) + Number(controlFindings) + Number(dependencyFindings);
  if (url.searchParams.getAll("scopeId").length !== 1
    || url.searchParams.get("scopeId") !== SCOPE
    || selectedModes > 1
    || url.searchParams.size !== (selectedModes === 1 ? 2 : 1)
    || (dependencyFindings && (url.searchParams.getAll("dependencyFindings").length !== 1
      || url.searchParams.get("dependencyFindings") !== "runtime"))
    || (controlFindings && (url.searchParams.getAll("controlFindings").length !== 1
      || url.searchParams.get("controlFindings") !== "latest"))
    || (osvDetails && (url.searchParams.getAll("dependencyAdvisories").length !== 1
      || url.searchParams.get("dependencyAdvisories") !== "runtime"))
    || (details && (url.searchParams.getAll("sourceId").length !== 1
      || !SECURITY_WORKFLOWS.some(p => p.sourceId === selectedSourceId)))) {
    return reject(requestId, 400, "invalid_security_center_query");
  }
  // Fail closed when a real runtime context is absent; never substitute a synthetic scan.
  let environment: RuntimeEnvironment;
  try {
    environment = resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
  } catch {
    return reject(requestId, 503, "runtime_environment_required");
  }
  let actorId: string;
  try {
    const authentication = await requireAuthenticatedUser(request, env.DB);
    if (!authentication.allowed) return reject(requestId, 401, "authentication_required");
    actorId = authentication.user.id;
  } catch {
    return reject(requestId, 503, "authentication_unavailable");
  }
  try {
    const authz = await requireScopedAuthorization({
      db: env.DB, userId: actorId, policy: POLICY, action: ACTION,
      requestedScopeId: SCOPE, resourceScopeId: SCOPE,
    });
    if (!authz.allowed) return reject(requestId, 403, "forbidden");
  } catch {
    return reject(requestId, 503, "authorization_unavailable");
  }
  try {
    const asOf = new Date().toISOString();
    // Security advisory network traffic occurs only after authn+scoped authz.
    // It is a separate, reviewed lockfile scope; never global Finding evidence.
    if (osvDetails) {
      return Response.json(await osvReader(environment, asOf), {
        headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
      });
    }
    if (dependencyFindings) {
      const result = await osvReader(environment, asOf);
      return Response.json(projectRuntimeOsvFindings(result, asOf), {
        headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
      });
    }
    const sources = await sourceReader(environment, asOf);
    if (details) {
      const source = sources.find(item => item.sourceId === selectedSourceId);
      if (!source) return reject(requestId, 503, "security_center_unavailable");
      return Response.json(await stepReader(source, asOf), {
        headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
      });
    }
    if (controlFindings) {
      return Response.json(await projectObservedCiControlFindings(sources, asOf, stepReader), {
        headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
      });
    }
    return Response.json(projectSecurityCenter(asOf, sources), {
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return reject(requestId, 503, "security_center_unavailable");
  }
};
