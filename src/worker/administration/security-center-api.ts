import { requireAuthenticatedUser, requireScopedAuthorization } from "../authorization";
import { apiErrorResponse } from "../http";
import { resolveWorkhubRuntimeEnvironment } from "../workhub-login";
import type { RuntimeEnvironment } from "../../shared/runtime";
import { readSecurityCenterSources, unconnectedSecuritySources, readSecurityCenterStep, SECURITY_WORKFLOWS, type SecurityCenterSource, type SecurityCenterSourceReader, type SecurityCenterStepReader } from "./security-center-source-reader";
import scsMapping from "../../../config/scs-control-mapping.json";
import { readRuntimeOsvAdvisories, type RuntimeOsvReader } from "./security-osv-advisory-reader";

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

export const handleSecurityCenterApi = async (
  request: Request, env: Env, requestId: string,
  sourceReader: SecurityCenterSourceReader = readSecurityCenterSources,
  stepReader: SecurityCenterStepReader = readSecurityCenterStep,
  osvReader: RuntimeOsvReader = readRuntimeOsvAdvisories,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return null;
  if (request.method !== "GET") return reject(requestId, 405, "method_not_allowed");
  // Two strictly bounded read modes on one existing route. No arbitrary Run/URL input.
  const details = url.searchParams.has("sourceId");
  const osvDetails = url.searchParams.has("dependencyAdvisories");
  const selectedSourceId = url.searchParams.get("sourceId");
  if (url.searchParams.getAll("scopeId").length !== 1
    || url.searchParams.get("scopeId") !== SCOPE
    || (details && osvDetails)
    || url.searchParams.size !== (details || osvDetails ? 2 : 1)
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
    const sources = await sourceReader(environment, asOf);
    if (details) {
      const source = sources.find(item => item.sourceId === selectedSourceId);
      if (!source) return reject(requestId, 503, "security_center_unavailable");
      return Response.json(await stepReader(source, asOf), {
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
