import assert from "node:assert/strict";
import test from "node:test";
import { handleSecurityCenterApi, projectSecurityCenter } from "../src/worker/administration/security-center-api";
import { unconnectedSecuritySources, type SecurityCenterSourceReader, type SecurityCenterStepReader } from "../src/worker/administration/security-center-source-reader";

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
