import assert from "node:assert/strict";
import test from "node:test";
import {
  handleRecoveryReadinessApi, projectRecoveryCenter, type RecoveryEvidenceReader,
} from "../src/worker/administration/recovery-readiness-api";
import type { RecoveryObservation } from "../src/shared/recovery/readiness";

const root = "https://example.test/api/admin/operations/recovery-readiness";
const noSessionDb = {
  prepare() {
    return { bind() { return { first: async () => null, all: async () => ({ results: [] }) }; } };
  },
} as unknown as D1Database;
const sessionDb = (role: string | null): D1Database => ({
  prepare(sql: string) {
    return { bind() { return { first: async () => sql.includes("JOIN users") ? {
      id: "recovery-admin", displayName: "Fixture", lastSeenAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } : role === null ? null : { userId: "recovery-admin", scopeId: "workhub-company", role } }; } };
  },
}) as unknown as D1Database;
const req = () => new Request(root + "?scopeId=workhub-company",
  { headers: { cookie: "app_session=synthetic-test-only" } });

test("#431 only fixed-scope GET reaches authenticated/scoped Recovery projection", async () => {
  const env = { DB: noSessionDb, RUNTIME_ENVIRONMENT: "test" };
  assert.equal(await handleRecoveryReadinessApi(
    new Request("https://example.test/api/admin/not-recovery"), env, "not-route"), null);
  const post = await handleRecoveryReadinessApi(new Request(req().url, { method: "POST" }), env, "post");
  assert.equal(post?.status, 405);
  for (const query of ["", "?scopeId=other", "?scopeId=workhub-company&scopeId=workhub-company",
    "?scopeId=workhub-company&provider=cloudflare",
    "?scopeId=workhub-company&restore=1", "?scopeId=workhub-company&sha=abc"]) {
    const response = await handleRecoveryReadinessApi(new Request(root + query), env, "bad-query");
    assert.equal(response?.status, 400, query);
  }
  const anonymous = await handleRecoveryReadinessApi(new Request(req().url), env, "anon");
  assert.equal(anonymous?.status, 401);
  assert.doesNotMatch(await anonymous!.text(), /recoveryPoint|lastSuccessfulBackupAt/u);
  const noRuntime = await handleRecoveryReadinessApi(new Request(req().url),
    { DB: noSessionDb }, "missing-runtime");
  assert.equal(noRuntime?.status, 503);
});

test("#430 direct GET denies unauthorized users and never calls evidence adapter", async () => {
  let reads = 0;
  const reader: RecoveryEvidenceReader = async () => { reads++; return null; };
  for (const role of [null, "employee"]) {
    const response = await handleRecoveryReadinessApi(req(),
      { DB: sessionDb(role), RUNTIME_ENVIRONMENT: "preview" }, "forbidden", reader);
    assert.equal(response?.status, 403);
  }
  const anonymous = await handleRecoveryReadinessApi(new Request(req().url),
    { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" }, "anonymous", reader);
  assert.equal(anonymous?.status, 401);
  assert.equal(reads, 0);
});

test("#431 authorized admin sees honest UNKNOWN baseline; no provider/restore commands", async () => {
  const response = await handleRecoveryReadinessApi(req(),
    { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" }, "allowed");
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  const body = await response!.json() as ReturnType<typeof projectRecoveryCenter>;
  assert.equal(body.recovery.sourceState, "not-connected");
  assert.equal(body.recovery.protection, "UNKNOWN");
  assert.equal(body.recovery.readiness, "UNKNOWN");
  assert.equal(body.actionRequired, null);
  assert.equal(body.finding, null);
  assert.deepEqual(body.restoreGate, {
    operationId: "recovery.restore", policyVersion: "operations-policy-v1",
    risk: "HUMAN_GATE", policyDecision: "HUMAN_GATE", executionAllowed: false,
  });
});

test("#430 adapter failure is unknown, not zero/readiness healthy and never leaks credentials", async () => {
  const response = await handleRecoveryReadinessApi(req(),
    { DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "preview" }, "failed",
    async () => { throw new Error("fixture-provider-secret-token"); });
  assert.equal(response?.status, 200);
  const body = await response!.text();
  assert.match(body, /"sourceState":"unavailable"/u);
  assert.match(body, /"readiness":"UNKNOWN"/u);
  assert.doesNotMatch(body, /fixture-provider-secret-token|access_token|providerUrl/u);
});

test("#429/#430 confirmed RPO breach creates separate Finding and ActionRequired without execution", () => {
  const observedAt = "2026-10-18T06:00:00.000Z";
  const evidence: RecoveryObservation = {
    sourceState: "available", observationComplete: true, observedAt,
    backup: { lastSuccessfulAt: "2026-10-18T05:00:00.000Z",
      lastVerifiedAt: "2026-10-18T05:00:00.000Z" },
    recoveryPoint: { at: "2026-10-18T05:00:00.000Z", verified: true },
    targets: { rpoMinutes: 30, rtoMinutes: 90, restoreMaxAgeHours: 24 },
    restore: null,
  };
  const payload = projectRecoveryCenter("production", observedAt, evidence);
  assert.equal(payload.recovery.rpo.status, "BREACHED");
  assert.equal(payload.recovery.readiness, "NOT_READY");
  assert.equal(payload.finding?.id, "recovery_rpo_breach");
  assert.equal(payload.actionRequired?.findingId, payload.finding?.id);
  assert.equal(payload.actionRequired?.operationId, "recovery.review");
  assert.equal(payload.restoreGate.policyDecision, "HUMAN_GATE");
  assert.equal(payload.restoreGate.executionAllowed, false);
  const unknown = projectRecoveryCenter("production", observedAt, null);
  assert.equal(unknown.finding, null);
  assert.equal(unknown.actionRequired, null, "unknown provider cannot create a fake breached RPO");
});

test("#430 forbidden Production restore is never offered in local, preview, test or production", () => {
  for (const environment of ["local", "test", "preview", "production"] as const) {
    const result = projectRecoveryCenter(environment, "2026-10-18T06:00:00.000Z", null);
    assert.equal(result.restoreGate.risk, "HUMAN_GATE");
    assert.equal(result.restoreGate.policyDecision, "HUMAN_GATE");
    assert.equal(result.restoreGate.executionAllowed, false);
  }
});
