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
    } : role === null ? null : { userId: "recovery-admin", scopeId: "workhub-company", role },
      all: async () => ({ results: [] }) }; } };
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
    "?scopeId=workhub-company&restore=1", "?scopeId=workhub-company&sha=abc",
    "?scopeId=workhub-company&incidentId=spoofed",
    "?scopeId=workhub-company&checkpoint=PASSED"]) {
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
  assert.equal(body.recoveryPlan.steps.length, 11);
  assert.equal(body.recoveryPlan.evidenceSource, "not-connected");
  assert.equal(body.recoveryPlan.resumeDecision, "BLOCKED");
  assert.equal(body.recoveryPlan.resumeExecutionAllowed, false);
  assert.deepEqual(body.auditEvidence, {
    source: "durable-d1-audit", status: "NONE",
    recordsChecked: 0, latestAuditAt: null, hasMore: false,
    provesRecoverability: false,
  });
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
  assert.match(body, /"resumeDecision":"BLOCKED"/u);
  assert.match(body, /"evidenceSource":"not-connected"/u);
  assert.match(body, /"provesRecoverability":false/u);
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
    assert.equal(result.recoveryPlan.steps.length, 11);
    assert.equal(result.recoveryPlan.resumeExecutionAllowed, false);
    assert.equal(result.recoveryPlan.resumeDecision, "BLOCKED");
    assert.equal(result.auditEvidence.provesRecoverability, false);
  }
});

test("#429/#430 failed, stale and RTO-breached restore checks create a bounded human review Finding", () => {
  const NOW = "2026-10-18T06:00:00.000Z";
  const source: RecoveryObservation = {
    sourceState: "available", observationComplete: true,
    observedAt: NOW,
    backup: { lastSuccessfulAt: "2026-10-18T05:30:00.000Z", lastVerifiedAt: "2026-10-18T05:30:00.000Z" },
    recoveryPoint: { at: "2026-10-18T05:30:00.000Z", verified: true },
    targets: { rpoMinutes: 60, rtoMinutes: 45, restoreMaxAgeHours: 24 },
    restore: {
      completedAt: "2026-10-18T05:45:00.000Z",
      testedRecoveryPointAt: "2026-10-18T05:30:00.000Z",
      result: "PASSED", durationMinutes: 20,
      checks: { application: "PASSED", dataIntegrity: "PASSED",
        businessConsistency: "PASSED", integrations: "PASSED",
        jobs: "PASSED", security: "PASSED", audit: "PASSED" },
    },
  };
  const failure = projectRecoveryCenter("production", NOW, {
    ...source, restore: { ...source.restore!, result: "FAILED",
      checks: { ...source.restore!.checks, dataIntegrity: "FAILED" } },
  });
  assert.equal(failure.recovery.restoreTest?.checks.dataIntegrity, "FAILED");
  assert.equal(failure.finding?.id, "recovery_restore_verification_failed");
  assert.equal(failure.actionRequired?.operationId, "recovery.review");
  assert.equal(failure.recoveryPlan.resumeDecision, "BLOCKED");
  assert.equal(failure.restoreGate.executionAllowed, false);

  const overdue = projectRecoveryCenter("production", NOW, {
    ...source,
    targets: { rpoMinutes: 43200, rtoMinutes: 45, restoreMaxAgeHours: 24 },
    backup: { lastSuccessfulAt: "2026-10-16T04:00:00.000Z",
      lastVerifiedAt: "2026-10-16T04:00:00.000Z" },
    recoveryPoint: { at: "2026-10-16T04:00:00.000Z", verified: true },
    restore: { ...source.restore!, testedRecoveryPointAt: "2026-10-16T04:00:00.000Z",
      completedAt: "2026-10-16T05:00:00.000Z" },
  });
  assert.equal(overdue.recovery.restoreFreshness, "STALE");
  assert.equal(overdue.finding?.id, "recovery_restore_test_stale");
  assert.equal(overdue.actionRequired?.findingId, overdue.finding?.id);
  assert.equal(overdue.recoveryPlan.resumeExecutionAllowed, false);

  const overRto = projectRecoveryCenter("production", NOW, {
    ...source, restore: { ...source.restore!, durationMinutes: 60 },
  });
  assert.equal(overRto.recovery.rto.status, "BREACHED");
  assert.equal(overRto.finding?.id, "recovery_rto_breach");
  assert.equal(overRto.actionRequired?.operationId, "recovery.review");

  const healthy = projectRecoveryCenter("production", NOW, source);
  assert.equal(healthy.recovery.readiness, "READY");
  assert.equal(healthy.finding, null);
  assert.equal(healthy.actionRequired, null);
  assert.equal(healthy.restoreGate.executionAllowed, false, "rehearsal READY is not restore permission");
  assert.equal(healthy.recoveryPlan.resumeExecutionAllowed, false, "incident Resume remains blocked");
});

test("#431 authorized Worker GET transports actual bounded post-restore check results", async () => {
  const response = await handleRecoveryReadinessApi(req(), {
    DB: sessionDb("system_admin"), RUNTIME_ENVIRONMENT: "test",
  }, "verified-evidence", async (_env, asOf) => {
    const point = new Date(Date.parse(asOf) - 30 * 60_000).toISOString();
    return {
      sourceState: "available", observationComplete: true, observedAt: asOf,
      backup: { lastSuccessfulAt: point, lastVerifiedAt: point },
      recoveryPoint: { at: point, verified: true },
      targets: { rpoMinutes: 60, rtoMinutes: 45, restoreMaxAgeHours: 24 },
      restore: { completedAt: asOf, testedRecoveryPointAt: point,
        result: "FAILED", durationMinutes: 15,
        checks: { application: "PASSED", dataIntegrity: "FAILED",
          businessConsistency: "PASSED", integrations: "PASSED",
          jobs: "PASSED", security: "PASSED", audit: "PASSED" },
      },
    } satisfies RecoveryObservation;
  });
  assert.equal(response?.status, 200);
  const body = await response!.json() as ReturnType<typeof projectRecoveryCenter>;
  assert.equal(body.recovery.sourceState, "available");
  assert.equal(body.recovery.restoreTest?.checks.dataIntegrity, "FAILED");
  assert.equal(body.recovery.postRestoreVerification, "FAILED");
  assert.equal(body.finding?.id, "recovery_restore_verification_failed");
  assert.equal(body.actionRequired?.operationId, "recovery.review");
  assert.equal(body.restoreGate.executionAllowed, false);
});
