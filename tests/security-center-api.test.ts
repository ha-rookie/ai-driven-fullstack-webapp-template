import assert from "node:assert/strict";
import test from "node:test";
import { handleSecurityCenterApi, projectSecurityCenterReadModel } from "../src/worker/administration/security-center-api";

const DB = {
  prepare() {
    return { bind() {
      return { first: async () => null, all: async () => ({ results: [] }) };
    } };
  },
} as unknown as D1Database;
const env = { DB, RUNTIME_ENVIRONMENT: "test" };
const route = "https://example.test/api/admin/security-center?scopeId=workhub-company";

test("#420 fixed Security Center read model never fabricates findings or scanner success", () => {
  const result = projectSecurityCenterReadModel("2026-10-16T08:00:00.000Z");
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.scopeId, "workhub-company");
  assert.equal(result.evidenceBoundary, "no_live_security_source_connected");
  assert.equal(result.findings.availability, "not-checked");
  assert.equal(result.findings.verifiedCount, null);
  assert.deepEqual(result.findings.items, []);
  assert.equal(result.sources.length, 4);
  for (const source of result.sources) {
    assert.equal(source.connection, "not-connected");
    assert.equal(source.checkConclusion, null);
    assert.equal(source.coverage.coverageState, "not-checked");
    assert.equal(source.coverage.sourceHealth, "unmonitored");
    assert.equal(source.coverage.checkedFindingCount, null);
    assert.equal(source.coverage.freshness, "unknown");
    assert.equal("lastSuccessfulCheckAt" in source.coverage, false);
    assert.equal("securityScore" in source.coverage, false);
  }
  const raw = JSON.stringify(result);
  for (const word of ["bearer token", "rawLog", "secretValue", "isSecure", "scsCertified"]) {
    assert.equal(raw.includes(word), false);
  }
});

test("#420 route is strict GET-only and never handles another path", async () => {
  const notFound = await handleSecurityCenterApi(
    new Request("https://example.test/api/admin/another"), env, "req-other");
  assert.equal(notFound, null);
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
    const response = await handleSecurityCenterApi(new Request(route, { method }), env, "req-method");
    assert.equal(response?.status, 405);
  }
});

test("#420 rejects ambiguous scope, rogue query keys and cross-scope access", async () => {
  for (const suffix of [
    "", "?scopeId=workhub-company&scopeId=workhub-company",
    "?scopeId=workhub-company&role=system_admin",
  ]) {
    const response = await handleSecurityCenterApi(
      new Request("https://example.test/api/admin/security-center" + suffix), env, "req-params");
    assert.equal(response?.status, 400);
  }
  for (const suffix of ["?scopeId=other-company", "?scopeId="]) {
    const response = await handleSecurityCenterApi(
      new Request("https://example.test/api/admin/security-center" + suffix), env, "req-other-scope");
    assert.equal(response?.status, 403);
  }
});

test("#420 unauthenticated caller gets 401 and no security-source records", async () => {
  const response = await handleSecurityCenterApi(new Request(route), env, "req-anonymous");
  assert.equal(response?.status, 401);
  const text = await response!.text();
  assert.ok(text.includes("authentication_required"));
  assert.ok(!text.includes("sourceKind"));
  assert.ok(!text.includes("coverageState"));
});

test("#420 remote runtime configuration absence is a 503, not simulated local scan", async () => {
  const response = await handleSecurityCenterApi(new Request(route), { DB }, "req-runtime");
  assert.equal(response?.status, 503);
  assert.ok((await response!.text()).includes("runtime_environment_required"));
});

test("#420 fixed request timestamp can never be interpreted as a scanner time", () => {
  const asOf = "2026-10-16T08:40:00.000Z";
  const read = projectSecurityCenterReadModel(asOf);
  assert.equal(read.observedAt, asOf);
  assert.ok(read.sources.every(x => !("lastSuccessfulCheckAt" in x.coverage)));
  assert.equal("severity" in read.findings, false);
  assert.equal("auditEvents" in read.findings, false);
});
