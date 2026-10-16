import { projectRuntimeOsvFindings } from "../src/worker/administration/security-center-api";
import assert from "node:assert/strict";
import test from "node:test";
import { handleSecurityCenterApi, projectSecurityCenter } from "../src/worker/administration/security-center-api";
import { unconnectedSecuritySources, type SecurityCenterSourceReader, type SecurityCenterStepReader } from "../src/worker/administration/security-center-source-reader";
import { normalizeSecurityFinding } from "../src/shared/security/security-finding";

const noSessionDb = {
  prepare() {
    return { bind() {
      return { first: async () => null, all: async () => ({ results: [] }) };
    } };
  },
} as unknown as D1Database;

test("#420 no connected security source is never reported as zero or safe", () => {
  const view = projectSecurityCenter("2026-10-16T00:00:00.000Z");
  assert.equal(view.posture, "not-assessed");
  assert.equal(view.findings.state, "not-connected");
  assert.equal(view.findings.verifiedCount, null);
  assert.equal(view.sources.length, 4);
  for (const source of view.sources) {
    assert.equal(source.coverageState, "not-checked");
    assert.equal(source.sourceHealth, "unmonitored");
    assert.equal(source.freshness, "unknown");
    assert.equal(source.checkedFindingCount, null);
    assert.equal(source.lastSuccessfulCheckAt, undefined);
  }
  assert.equal(view.scs.certification, "not-assessed");
  assert.equal(view.scs.requirements.length, 43);
  assert.ok(view.scs.requirements.every((r) => r.evidenceFreshness === "unknown"
    && r.finding === null && r.remediation === null));
  assert.ok(view.scs.requirements.some((r) => r.responsibility === "Organization Responsibility"));
  assert.ok(!JSON.stringify(view).includes('"verifiedCount":0'));
});

test("#420 only fixed-scope GET may reach server-side authorization", async () => {
  const base = "https://example.test/api/admin/security/center";
  const env = { DB: noSessionDb, RUNTIME_ENVIRONMENT: "test" };
  assert.equal(await handleSecurityCenterApi(new Request("https://example.test/api/admin/other"),
    env, "request-no-match"), null);
  assert.equal((await handleSecurityCenterApi(new Request(base + "?scopeId=workhub-company",
    { method: "POST" }), env, "request-method"))?.status, 405);
  for (const query of ["", "?scopeId=another", "?scopeId=workhub-company&admin=true",
    "?scopeId=workhub-company&scopeId=workhub-company"]) {
    assert.equal((await handleSecurityCenterApi(new Request(base + query), env, "request-query"))?.status,
      400);
  }
  const anonymous = await handleSecurityCenterApi(
    new Request(base + "?scopeId=workhub-company"), env, "request-anon");
  assert.equal(anonymous?.status, 401);
});

test("#420 rejects missing runtime context with 503 rather than inventing findings", async () => {
  const endpoint = "https://example.test/api/admin/security/center?scopeId=workhub-company";
  const response = await handleSecurityCenterApi(
    new Request(endpoint), { DB: noSessionDb }, "request-no-runtime");
  assert.equal(response?.status, 503);
  const body = await response!.text();
  assert.match(body, /runtime_environment_required/u);
  assert.doesNotMatch(body, /checkedFindingCount|sourceKind|control|evidenceReference/u);
});

test("#420 rejects every unsupported HTTP method before authentication or data exposure", async () => {
  const endpoint = "https://example.test/api/admin/security/center?scopeId=workhub-company";
  const env = { DB: noSessionDb, RUNTIME_ENVIRONMENT: "test" };
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
    const response = await handleSecurityCenterApi(new Request(endpoint, { method }), env, "request-method");
    assert.equal(response?.status, 405, method);
  }
});

test("#420 anonymous response contains no security source, SCS control or evidence data", async () => {
  const endpoint = "https://example.test/api/admin/security/center?scopeId=workhub-company";
  const response = await handleSecurityCenterApi(
    new Request(endpoint), { DB: noSessionDb, RUNTIME_ENVIRONMENT: "test" }, "request-anon");
  assert.equal(response?.status, 401);
  const body = await response!.text();
  assert.match(body, /authentication_required/u);
  assert.doesNotMatch(body, /checkedFindingCount|sourceKind|requirement|evidenceReference/u);
});

test("#420 projection timestamp is a request timestamp, not evidence of a completed scan", () => {
  const time = "2026-10-16T09:00:00.000Z";
  const status = projectSecurityCenter(time);
  assert.equal(status.observedAt, time);
  assert.ok(status.sources.every(source => source.lastSuccessfulCheckAt === undefined));
  assert.ok(status.scs.requirements.every(requirement =>
    requirement.evidenceFreshness === "unknown" &&
    requirement.finding === null &&
    requirement.remediation === null));
  assert.equal("lastScannedAt" in status, false);
  assert.equal("securityScore" in status, false);
});

const sessionDb = (role: string | null): D1Database => ({
  prepare(sql: string) {
    return { bind() { return { first: async () => sql.includes("JOIN users") ? {
      id: "fixture-admin", displayName: "Fixture", lastSeenAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } : role === null ? null : { userId: "fixture-admin", scopeId: "workhub-company", role } }; } };
  },
}) as unknown as D1Database;
const authenticatedRequest = () => new Request(
  "https://example.test/api/admin/security/center?scopeId=workhub-company",
  { headers: { cookie: "app_session=synthetic-session-only" } },
);

test("#420 server authenticates and authorizes every source read, including direct API calls", async () => {
  let reads = 0;
  const reader: SecurityCenterSourceReader = async (_environment, asOf) => { reads++; return unconnectedSecuritySources(asOf); };
  for (const role of [null, "employee"]) {
    const response = await handleSecurityCenterApi(authenticatedRequest(),
      { DB: sessionDb(role), RUNTIME_ENVIRONMENT: "preview" }, "denied", reader);
    assert.equal(response?.status, 403); assert.equal(reads, 0);
  }
  const anonymous = await handleSecurityCenterApi(new Request(authenticatedRequest().url),
    { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" }, "anonymous", reader);
  assert.equal(anonymous?.status, 401); assert.equal(reads, 0);
  const allowed = await handleSecurityCenterApi(authenticatedRequest(),
    { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" }, "allowed", reader);
  assert.equal(allowed?.status, 200); assert.equal(reads, 1);
  assert.equal(allowed?.headers.get("cache-control"), "no-store");
  const body = await allowed!.json() as { findings: { verifiedCount: unknown } };
  assert.equal(body.findings.verifiedCount, null);
});

test("#420 reader failure is 503 with no provider error or invented status", async () => {
  const response = await handleSecurityCenterApi(authenticatedRequest(),
    { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" }, "reader-failed",
    async () => { throw new Error("fixture-provider-private-value"); });
  assert.equal(response?.status, 503);
  const body = await response!.text();
  assert.match(body, /security_center_unavailable/u);
  assert.doesNotMatch(body, /fixture-provider-private-value|checkedFindingCount|requirements/u);
});

test("#420 fixed CI control-step query rejects arbitrary sources, run IDs, URLs and duplicate keys", async () => {
  const root = "https://example.test/api/admin/security/center?scopeId=workhub-company";
  const env = { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" };
  let reads = 0;
  const sources: SecurityCenterSourceReader = async (_environment, asOf) => {
    reads++; return unconnectedSecuritySources(asOf);
  };
  for (const suffix of ["&sourceId=evil", "&runId=42", "&sourceId=secret_detection&runId=42",
    "&sourceId=secret_detection&sourceId=secret_detection", "&sourceId=secret_detection&url=evil",
    "&sourceId=", "&sourceId=https%3A%2F%2Fevil.test"]) {
    const response = await handleSecurityCenterApi(
      new Request(root + suffix), env, "invalid-params", sources);
    assert.equal(response?.status, 400, suffix);
  }
  assert.equal(reads, 0);
});

test("#420 user/role check completes before any public GitHub CI job/step request", async () => {
  const url = "https://example.test/api/admin/security/center?scopeId=workhub-company&sourceId=secret_detection";
  let sourcesRead = 0; let stepsRead = 0;
  const sourceReader: SecurityCenterSourceReader = async (_env, now) => {
    sourcesRead++; return unconnectedSecuritySources(now);
  };
  const stepReader: SecurityCenterStepReader = async () => {
    stepsRead++; return { schemaVersion: 1, sourceId: "secret_detection", stepCode: "secret_scan",
      runId: null, targetSha: null, state: "not-run", conclusion: null };
  };
  const anonymous = await handleSecurityCenterApi(new Request(url),
    { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" }, "anon", sourceReader, stepReader);
  assert.equal(anonymous?.status, 401);
  for (const role of ["employee", null]) {
    const request = new Request(url, { headers: { cookie: "app_session=synthetic-session-only" } });
    const denied = await handleSecurityCenterApi(request,
      { DB: sessionDb(role), RUNTIME_ENVIRONMENT: "preview" }, "denied", sourceReader, stepReader);
    assert.equal(denied?.status, 403);
  }
  assert.equal(sourcesRead, 0); assert.equal(stepsRead, 0);
  const allowed = await handleSecurityCenterApi(
    new Request(url, { headers: { cookie: "app_session=synthetic-session-only" } }),
    { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" }, "allowed",
    sourceReader, stepReader);
  assert.equal(allowed?.status, 200);
  assert.equal(allowed?.headers.get("cache-control"), "no-store");
  assert.equal(sourcesRead, 1); assert.equal(stepsRead, 1);
  assert.deepEqual(await allowed?.json(), {
    schemaVersion: 1, sourceId: "secret_detection", stepCode: "secret_scan",
    runId: null, targetSha: null, state: "not-run", conclusion: null,
  });
});

test("#420 CI job-read failure cannot leak upstream response, actor, logs or server context", async () => {
  const url = "https://example.test/api/admin/security/center?scopeId=workhub-company&sourceId=secret_detection";
  const response = await handleSecurityCenterApi(
    new Request(url, { headers: { cookie: "app_session=synthetic-session-only" } }),
    { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" }, "failed",
    async (_env, time) => unconnectedSecuritySources(time),
    async () => { throw new Error("fixture-private-provider-error"); });
  assert.equal(response?.status, 503);
  const body = await response!.text();
  assert.doesNotMatch(body, /fixture-private-provider-error|Run ID|logs_url|checkedFindingCount/u);
  assert.match(body, /security_center_unavailable/u);
});


test("#420 OSV runtime lookup enforces fixed query and rejects every injection before source access", async () => {
  const base = "https://example.test/api/admin/security/center?scopeId=workhub-company";
  const env = { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" };
  let sources = 0; let scans = 0;
  const sourceReader: SecurityCenterSourceReader = async (_, time) => {
    sources++; return unconnectedSecuritySources(time);
  };
  const osvReader = async () => {
    scans++;
    return { schemaVersion: 1 as const, source: "OSV" as const,
      scope: "runtime-lock-only" as const, state: "unavailable" as const,
      checkedAt: null, checkedPackages: null, advisoryCount: null, advisories: null };
  };
  for (const suffix of [
    "&dependencyAdvisories=", "&dependencyAdvisories=all",
    "&dependencyAdvisories=runtime&sourceId=dependency_audit",
    "&dependencyAdvisories=runtime&dependencyAdvisories=runtime",
    "&dependencyAdvisories=runtime&url=https://evil.test",
    "&dependencyAdvisories=runtime&scopeId=workhub-company",
  ]) {
    const response = await handleSecurityCenterApi(
      new Request(base + suffix, { headers: {cookie:"app_session=synthetic-session-only"} }),
      env, "osv-query", sourceReader, undefined, osvReader);
    assert.equal(response?.status, 400, suffix);
  }
  assert.equal(sources, 0);
  assert.equal(scans, 0);
});

test("#420 authenticated scoped administrator is the only actor permitted to query real OSV mode", async () => {
  const url = "https://example.test/api/admin/security/center?scopeId=workhub-company&dependencyAdvisories=runtime";
  let reads = 0; let sourceReads = 0;
  const sourceReader: SecurityCenterSourceReader = async (_env, time) => {
    sourceReads++; return unconnectedSecuritySources(time);
  };
  const osvReader = async () => {
    reads++;
    return { schemaVersion: 1 as const, source: "OSV" as const,
      scope: "runtime-lock-only" as const, state: "verified" as const,
      checkedAt: new Date().toISOString(), checkedPackages: 12,
      advisoryCount: 0, advisories: [] };
  };
  const anonymous = await handleSecurityCenterApi(new Request(url),
    {DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT:"preview"}, "anonymous",
    sourceReader, undefined, osvReader);
  assert.equal(anonymous?.status, 401);
  for (const role of ["employee", null]) {
    const response = await handleSecurityCenterApi(new Request(url, {
      headers: { cookie: "app_session=synthetic-session-only" },
    }), { DB: sessionDb(role), RUNTIME_ENVIRONMENT:"preview" }, "denied",
    sourceReader, undefined, osvReader);
    assert.equal(response?.status, 403);
  }
  assert.equal(reads, 0); assert.equal(sourceReads, 0);
  const response = await handleSecurityCenterApi(new Request(url, {
    headers: { cookie: "app_session=synthetic-session-only" },
  }), { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT:"preview" },
  "allowed", sourceReader, undefined, osvReader);
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  const data = await response?.json() as {state:string;advisoryCount:number};
  assert.equal(data.state, "verified");
  assert.equal(data.advisoryCount, 0);
  assert.equal(reads, 1); assert.equal(sourceReads, 0);
});

test("#420 OSV upstream errors do not return advisory payload or treat failure as zero", async () => {
  const url = "https://example.test/api/admin/security/center?scopeId=workhub-company&dependencyAdvisories=runtime";
  const result = await handleSecurityCenterApi(new Request(url, {
    headers: { cookie: "app_session=synthetic-session-only" },
  }), { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT:"preview" }, "provider-error",
  undefined, undefined, async () => { throw Error("sensitive private data from upstream"); });
  assert.equal(result?.status, 503);
  const body = await result!.text();
  assert.match(body, /security_center_unavailable/u);
  assert.doesNotMatch(body, /sensitive private data|advisoryCount.*0/u);
});

test("#420 actual CI control failure projects one real-shaped verified Finding without claiming vulnerability zero", async () => {
  const endpoint = "https://example.test/api/admin/security/center?scopeId=workhub-company&controlFindings=latest";
  const run = { runId: 1042, targetSha: "a".repeat(40), checkStatus: "completed" as const,
    checkConclusion: "failure" as const, event: "pull_request" as const,
    updatedAt: "2026-10-16T10:00:00.000Z" };
  let steps = 0;
  const sources: SecurityCenterSourceReader = async (_environment, now) => {
    const base = unconnectedSecuritySources(now);
    return base.map((source, index) => index === 0 ? {
      ...source, coverageState: "unavailable" as const, sourceHealth: "unavailable" as const,
      ci: { state: "available" as const, fetchedAt: now, latest: run, latestSuccessfulRun: null },
    } : source);
  };
  const stepReader: SecurityCenterStepReader = async (source, asOf) => {
    steps++;
    assert.equal(source.sourceId, "secret_detection");
    return { schemaVersion: 1, sourceId: "secret_detection", stepCode: "secret_scan",
      runId: 1042, targetSha: run.targetSha, state: "observed", conclusion: "failure",
      controlFinding: normalizeSecurityFinding({
        ruleId: "ci_step_failure", category: "data", severity: "high", status: "open",
        resourceRef: "commit_" + run.targetSha.slice(0, 12),
        detectedAt: run.updatedAt, lastObservedAt: run.updatedAt,
        evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "run_1042" }],
        remediationCode: "review_control",
      }, source.sourceId, asOf) };
  };
  const env = { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" };
  const anonymous = await handleSecurityCenterApi(new Request(endpoint), env, "anon", sources, stepReader);
  assert.equal(anonymous?.status, 401);
  const denied = await handleSecurityCenterApi(new Request(endpoint, {
    headers: { cookie: "app_session=synthetic-session-only" },
  }), { ...env, DB: sessionDb("employee") }, "denied", sources, stepReader);
  assert.equal(denied?.status, 403); assert.equal(steps, 0);
  const allowed = await handleSecurityCenterApi(new Request(endpoint, {
    headers: { cookie: "app_session=synthetic-session-only" },
  }), env, "allowed", sources, stepReader);
  assert.equal(allowed?.status, 200);
  const snapshot = await allowed!.json() as {
    posture: string; findings: {state:string;verifiedCount:number;items:Array<{ruleId:string;sourceId:string}>};
    sources:Array<{coverageState:string;checkedFindingCount:number|null}>;
  };
  assert.equal(snapshot.posture, "not-assessed");
  assert.equal(snapshot.findings.state, "verified");
  assert.equal(snapshot.findings.verifiedCount, 1);
  assert.equal(snapshot.findings.items[0].ruleId, "ci_step_failure");
  assert.equal(snapshot.findings.items[0].sourceId, "secret_detection");
  assert.equal(snapshot.sources[0].checkedFindingCount, 1);
  assert.equal(snapshot.sources[1].checkedFindingCount, null);
  assert.equal(steps, 1);
});

test("#420 on-demand CI Finding refuses forged/mismatched step, ambiguous success and client-supplied parameters", async () => {
  const root = "https://example.test/api/admin/security/center?scopeId=workhub-company";
  const env = { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" };
  const request = (suffix: string) => new Request(root + suffix, {
    headers: { cookie: "app_session=synthetic-session-only" },
  });
  let reads = 0;
  const sources: SecurityCenterSourceReader = async (_, now) => {
    reads++;
    return unconnectedSecuritySources(now);
  };
  for (const query of ["&controlFindings=all", "&controlFindings=latest&sourceId=secret_detection",
    "&controlFindings=latest&controlFindings=latest", "&controlFindings=latest&runId=42",
    "&controlFindings=latest&url=https://other.test"]) {
    const denied = await handleSecurityCenterApi(request(query), env, "invalid", sources);
    assert.equal(denied?.status, 400, query);
  }
  assert.equal(reads, 0);
  const unavailable = await handleSecurityCenterApi(request("&controlFindings=latest"),
    env, "no-observed-failure", sources, async () => { throw Error("should not fetch unchecked source"); });
  assert.equal(unavailable?.status, 200);
  const snapshot = await unavailable!.json() as {findings:{state:string;items:null;verifiedCount:null}};
  assert.deepEqual(snapshot.findings, { state: "not-connected", items: null, verifiedCount: null });
  assert.equal(reads, 1);
});

test("#420 OSV real advisory projects a bounded dependency Finding, preserving unknown severity", () => {
  const now = "2026-10-17T00:00:00.000Z";
  const advisory = { packageRef: "pkg_01", advisoryId: "GHSA-aaaa-bbbb-cccc" };
  const result = projectRuntimeOsvFindings({ schemaVersion: 1, scope: "runtime-lock-only",
    source: "OSV", state: "verified", checkedAt: now, checkedPackages: 12,
    advisoryCount: 1, advisories: [advisory] }, now);
  assert.equal(result.posture, "not-assessed");
  assert.equal(result.findings.state, "verified");
  assert.equal(result.findings.verifiedCount, 1);
  assert.equal(result.findings.items?.[0]?.ruleId, "osv_advisory_0");
  assert.equal(result.findings.items?.[0]?.severity, "info");
  assert.equal(result.findings.items?.[0]?.evidence[0]?.code, "dependency_alert");
  assert.equal(result.sources.find(x => x.sourceId === "dependency_audit")?.checkedFindingCount, 1);
});
test("#420 two real OSV advisories on one package have distinct Finding identities", () => {
  const now = "2026-10-17T00:00:00.000Z";
  const projected = projectRuntimeOsvFindings({ schemaVersion: 1, scope: "runtime-lock-only",
    source: "OSV", state: "verified", checkedAt: now, checkedPackages: 12,
    advisoryCount: 2, advisories: [
      { packageRef: "pkg_01", advisoryId: "GHSA-aaaa-bbbb-cccc" },
      { packageRef: "pkg_01", advisoryId: "CVE-2026-12345" },
    ] }, now);
  assert.equal(projected.findings.verifiedCount, 2);
  assert.deepEqual(projected.findings.items?.map(x => x.ruleId),
    ["osv_advisory_0", "osv_advisory_1"]);
  assert.equal(projected.sources.find(x => x.sourceId === "dependency_audit")?.checkedFindingCount, 2);
});

test("#420 OSV unknown stays disconnected and source-scoped verified zero stays zero", () => {
  const now = "2026-10-17T00:00:00.000Z";
  const unavailable = projectRuntimeOsvFindings({ schemaVersion: 1, scope: "runtime-lock-only",
    source: "OSV", state: "unavailable", checkedAt: null, checkedPackages: null,
    advisoryCount: null, advisories: null }, now);
  assert.equal(unavailable.findings.state, "not-connected");
  const zero = projectRuntimeOsvFindings({ schemaVersion: 1, scope: "runtime-lock-only",
    source: "OSV", state: "verified", checkedAt: now, checkedPackages: 12,
    advisoryCount: 0, advisories: [] }, now);
  assert.equal(zero.findings.verifiedCount, 0);
  assert.equal(zero.posture, "not-assessed");
});
