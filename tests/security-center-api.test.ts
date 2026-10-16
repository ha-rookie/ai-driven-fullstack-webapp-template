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
  const env = { DB: noSessionDb };
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
  assert.equal(anonymous?.headers.get("cache-control"), "no-store");
});
