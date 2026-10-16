import assert from "node:assert/strict";
import test from "node:test";
import { handleSecurityCenterApi, projectSecurityCenter } from "../src/worker/administration/security-center-api";
import { unconnectedSecuritySources, type SecurityCenterSourceReader } from "../src/worker/administration/security-center-source-reader";

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
