import assert from "node:assert/strict";
import test from "node:test";
import { handleSecurityCenterApi, projectSecurityCenter } from "../src/worker/administration/security-center-api";

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
