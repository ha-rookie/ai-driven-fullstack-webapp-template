import assert from "node:assert/strict";
import test from "node:test";
import { appendLocalRecoveryDrillStep, createLocalRecoveryOperationAuditReader, readLocalRecoveryDrill } from
  "../src/worker/administration/recovery-local-drill";
import { RECOVERY_STEPS, projectRecoveryPlan } from "../src/shared/recovery/recovery-plan";
import { assessRecoveryReadiness, type RecoveryObservation } from "../src/shared/recovery/readiness";
import { projectRecoveryCenter, handleRecoveryReadinessApi } from "../src/worker/administration/recovery-readiness-api";

const NOW = "2026-10-18T06:00:00.000Z";
const RP = "2026-10-18T05:30:00.000Z";
type AuditRow = {
  id: string; environment: string; occurred_at: string;
  request_id: string; scope_id: string; resource_type: string; resource_id: string;
  record_json: string; record_sha256: string;
};
const durableFixture = (rows: AuditRow[] = [], role: string | null = "system_admin") => {
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes("JOIN users")) {
                return { id: "recovery-admin", displayName: "Fixture",
                  lastSeenAt: new Date().toISOString(),
                  expiresAt: new Date(Date.now() + 60_000).toISOString() };
              }
              return role === null ? null : { userId: "recovery-admin",
                scopeId: "workhub-company", role };
            },
            async run() {
              assert.match(sql, /INSERT INTO durable_audit_events/u);
              rows.push({
                id: values[0] as string, environment: values[1] as string,
                occurred_at: values[2] as string, request_id: values[3] as string,
                scope_id: values[8] as string, resource_type: values[9] as string,
                resource_id: values[10] as string, record_json: values[11] as string,
                record_sha256: values[12] as string,
              });
              return { meta: { changes: 1 } };
            },
            async all() {
              assert.match(sql, /FROM durable_audit_events/u);
              // Existing Recovery Center reads scoped Audit coverage without an
              // incident; the local drill reader additionally filters run/incident.
              const specific = values.length === 6;
              assert.equal(values.length === 4 || specific, true);
              const env = values[0], run = specific ? values[1] : null;
              const scope = values[specific ? 2 : 1];
              const type = values[specific ? 3 : 2];
              const incident = specific ? values[4] : null;
              const limit = values[specific ? 5 : 3] as number;
              assert.equal(scope, "workhub-company");
              assert.equal(type, "recovery");
              return {
                results: rows.filter(row => row.environment === env
                  && row.scope_id === scope && row.resource_type === type
                  && (!specific || (row.request_id === run && row.resource_id === incident)))
                  .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)
                    || b.id.localeCompare(a.id)).slice(0, limit),
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, rows };
};
const makeReady = (): RecoveryObservation => ({
  sourceState: "available", observationComplete: true, observedAt: NOW,
  backup: { lastSuccessfulAt: RP, lastVerifiedAt: "2026-10-18T05:31:00.000Z" },
  recoveryPoint: { at: RP, verified: true },
  targets: { rpoMinutes: 60, rtoMinutes: 45, restoreMaxAgeHours: 24 },
  restore: {
    completedAt: "2026-10-18T05:45:00.000Z", testedRecoveryPointAt: RP,
    result: "PASSED", durationMinutes: 30,
    checks: { application: "PASSED", dataIntegrity: "PASSED",
      businessConsistency: "PASSED", integrations: "PASSED",
      jobs: "PASSED", security: "PASSED", audit: "PASSED" },
  },
});
const when = (i: number) => "2026-10-18T05:" + String(32 + i).padStart(2, "0") + ":00.000Z";
const argsFor = (db: D1Database, runId = "drill-77", incidentId = "incident-77") =>
  ({ db, environment: "test" as const, runId, incidentId });
const passUntil = async (db: D1Database, length: number, failAt = -1) => {
  const args = argsFor(db);
  for (let i = 0; i < length; i++) {
    const step = RECOVERY_STEPS[i]!;
    if (step.id === "resume_service") throw new Error("cannot write Resume");
    await appendLocalRecoveryDrillStep(args, {
      id: step.id, result: i === failAt ? "FAILED" : "PASSED",
      ...(step.id === "restore" ? { simulatedApprovalId: "SIMULATED-human-review" } : {}),
    }, when(i));
  }
  return args;
};

test("#431 local D1 audit checkpointer preserves order and rehydrates after browser/client restart", async () => {
  const fixture = durableFixture();
  const args = await passUntil(fixture.db, 4);
  const initial = await readLocalRecoveryDrill(args, NOW);
  assert.equal(initial?.steps.length, 4);
  assert.deepEqual(initial?.steps.map(s => s.id), RECOVERY_STEPS.slice(0, 4).map(s => s.id));
  assert.equal(initial?.source, "verified-audit");
  assert.equal(initial?.environment, "test");
  assert.ok(initial?.steps.every(s => s.auditEventId.length > 0));
  const restarted = durableFixture(fixture.rows);
  const replayed = await readLocalRecoveryDrill(argsFor(restarted.db), NOW);
  assert.deepEqual(replayed, initial, "replay is reconstructed from the rows, not browser memory");
  const plan = projectRecoveryPlan(assessRecoveryReadiness(makeReady(), NOW), "test", NOW, replayed);
  assert.equal(plan.steps.slice(0, 4).filter(s => s.state === "VERIFIED").length, 4);
  assert.equal(plan.steps[4]?.state, "PENDING");
  assert.equal(plan.resumeDecision, "BLOCKED");
  assert.equal(plan.resumeExecutionAllowed, false);
});

test("#430 Golden #8: local persisted checkpoint needs Human Gate and ten verified steps, still never resumes", async () => {
  const { db } = durableFixture();
  const args = await passUntil(db, 4);
  await assert.rejects(appendLocalRecoveryDrillStep(args,
    { id: "restore", result: "PASSED" }, when(4)), /Human Gate/u);
  await assert.rejects(appendLocalRecoveryDrillStep(args,
    { id: "data_integrity", result: "PASSED" }, when(4)), /out of order/u);
  await passUntilFromFive(args);
  const replay = await readLocalRecoveryDrill(args, NOW);
  assert.equal(replay?.steps.length, 10);
  assert.equal(replay?.steps[4]?.humanApprovalId, "SIMULATED-human-review");
  const result = projectRecoveryCenter("test", NOW, makeReady(), replay);
  assert.equal(result.recoveryPlan.postRestore, "PASSED");
  assert.equal(result.recoveryPlan.resumeDecision, "HUMAN_REVIEW_REQUIRED");
  assert.equal(result.recoveryPlan.steps[10]?.state, "PENDING");
  assert.equal(result.recoveryPlan.resumeExecutionAllowed, false);
  assert.equal(result.restoreGate.policyDecision, "HUMAN_GATE");
  assert.equal(result.restoreGate.executionAllowed, false);
  await assert.rejects(appendLocalRecoveryDrillStep(args,
    { id: "restore", result: "PASSED", simulatedApprovalId: "SIMULATED-yes" }, when(10)));
});
const passUntilFromFive = async (args: ReturnType<typeof argsFor>): Promise<void> => {
  for (let i = 4; i < 10; i++) {
    const step = RECOVERY_STEPS[i]!;
    if (step.id === "resume_service") throw new Error("not a recordable step");
    await appendLocalRecoveryDrillStep(args, {
      id: step.id, result: "PASSED",
      ...(step.id === "restore" ? { simulatedApprovalId: "SIMULATED-human-review" } : {}),
    }, when(i));
  }
};

test("#430 Golden #7: mock Backup is not recovery, failed persisted integrity check blocks following steps", async () => {
  const { db } = durableFixture();
  const args = await passUntil(db, 6, 5);
  const replay = await readLocalRecoveryDrill(args, NOW);
  assert.equal(replay?.steps[5]?.result, "FAILED");
  const view = projectRecoveryCenter("test", NOW, {
    ...makeReady(), restore: { ...makeReady().restore!, result: "FAILED",
      checks: { ...makeReady().restore!.checks, dataIntegrity: "FAILED" } },
  }, replay);
  assert.equal(view.recovery.readiness, "NOT_READY");
  assert.equal(view.finding?.id, "recovery_restore_verification_failed");
  assert.equal(view.actionRequired?.findingId, view.finding?.id);
  assert.equal(view.recoveryPlan.postRestore, "FAILED");
  assert.equal(view.recoveryPlan.resumeDecision, "BLOCKED");
  assert.equal(view.recoveryPlan.resumeExecutionAllowed, false);
  await assert.rejects(appendLocalRecoveryDrillStep(args,
    { id: "business_consistency", result: "PASSED" }, when(6)), /terminal/u);
  assert.equal(assessRecoveryReadiness({ ...makeReady(), restore: null }, NOW).readiness, "UNKNOWN");
});

test("#429 logged checkpoint is not real approval; cross-environment, duplicate and corrupted audit fail closed", async () => {
  const fixture = durableFixture();
  const args = await passUntil(fixture.db, 2);
  for (const environment of ["preview", "production"] as const) {
    await assert.rejects(readLocalRecoveryDrill({ ...args, environment }, NOW), /local\/test-only/u);
    await assert.rejects(appendLocalRecoveryDrillStep({ ...args, environment },
      { id: "stop_outbound_integrations", result: "PASSED" }, when(2)), /local\/test-only/u);
  }
  await assert.rejects(appendLocalRecoveryDrillStep(args,
    { id: "stop_scheduled_jobs", result: "PASSED" }, when(2)), /out of order/u);
  const foreign = await readLocalRecoveryDrill({ ...args, incidentId: "another-incident" }, NOW);
  assert.equal(foreign, null);
  const copy = { ...fixture.rows[1]!, id: "duplicated-audit" };
  fixture.rows.push(copy);
  await assert.rejects(readLocalRecoveryDrill(args, NOW), /Inconsistent/u);
  fixture.rows.pop();
  fixture.rows[0]!.record_sha256 = "0".repeat(64);
  await assert.rejects(readLocalRecoveryDrill(args, NOW), /integrity/u);
});

const authenticated = () => new Request(
  "https://example.test/api/admin/operations/recovery-readiness?scopeId=workhub-company",
  { headers: { cookie: "app_session=synthetic-test-only" } },
);
const liveReadyFixture = async (_environment: string, asOf: string): Promise<RecoveryObservation> => {
  const point = new Date(Date.parse(asOf) - 30 * 60_000).toISOString();
  return {
    ...makeReady(), observedAt: asOf,
    backup: { lastSuccessfulAt: point, lastVerifiedAt: point },
    recoveryPoint: { at: point, verified: true },
    restore: { ...makeReady().restore!,
      completedAt: new Date(Date.parse(asOf) - 5 * 60_000).toISOString(),
      testedRecoveryPointAt: point },
  };
};

test("#431/#430 Golden #8: authorized API reloads the real D1 AuditStore reader after restart, never resumes", async () => {
  const fixture = durableFixture();
  const args = await passUntil(fixture.db, 10);
  const adapter = createLocalRecoveryOperationAuditReader(args);
  const env = { DB: fixture.db, RUNTIME_ENVIRONMENT: "test" };
  const first = await handleRecoveryReadinessApi(authenticated(), env,
    "local-golden-8-first", liveReadyFixture, adapter);
  assert.equal(first?.status, 200);
  const v1 = await first!.json() as ReturnType<typeof projectRecoveryCenter>;
  assert.equal(v1.recovery.readiness, "READY");
  assert.equal(v1.recoveryPlan.evidenceSource, "verified-audit");
  assert.equal(v1.recoveryPlan.steps.filter(s => s.state === "VERIFIED").length, 10);
  assert.equal(v1.recoveryPlan.postRestore, "PASSED");
  assert.equal(v1.recoveryPlan.resumeDecision, "HUMAN_REVIEW_REQUIRED");
  assert.equal(v1.recoveryPlan.resumeExecutionAllowed, false);
  assert.equal(v1.restoreGate.policyDecision, "HUMAN_GATE");
  assert.equal(v1.restoreGate.executionAllowed, false);
  assert.equal(v1.auditEvidence.status, "RECORDED");
  assert.equal(v1.auditEvidence.provesRecoverability, false);

  const recreated = durableFixture(fixture.rows);
  const next = await handleRecoveryReadinessApi(authenticated(),
    { DB: recreated.db, RUNTIME_ENVIRONMENT: "test" }, "local-golden-8-reloaded",
    liveReadyFixture, createLocalRecoveryOperationAuditReader(argsFor(recreated.db)));
  const v2 = await next!.json() as ReturnType<typeof projectRecoveryCenter>;
  assert.equal(next?.status, 200);
  assert.deepEqual(v2.recoveryPlan.steps, v1.recoveryPlan.steps,
    "server reconstructs audit checkpoints, never trusts browser state");
  assert.equal(v2.recoveryPlan.resumeExecutionAllowed, false);
});

test("#431/#430 Golden #7: authorized API maps failed persisted incident check to Finding/ActionRequired", async () => {
  const fixture = durableFixture();
  const args = await passUntil(fixture.db, 6, 5);
  const response = await handleRecoveryReadinessApi(authenticated(),
    { DB: fixture.db, RUNTIME_ENVIRONMENT: "test" }, "local-golden-7",
    liveReadyFixture, createLocalRecoveryOperationAuditReader(args));
  assert.equal(response?.status, 200);
  const result = await response!.json() as ReturnType<typeof projectRecoveryCenter>;
  assert.equal(result.recovery.readiness, "READY", "old rehearsal is independently READY");
  assert.equal(result.recoveryPlan.postRestore, "FAILED");
  assert.equal(result.recoveryPlan.steps[5]?.state, "FAILED");
  assert.equal(result.finding?.id, "recovery_incident_verification_failed");
  assert.equal(result.actionRequired?.findingId, result.finding?.id);
  assert.equal(result.actionRequired?.operationId, "recovery.review");
  assert.equal(result.recoveryPlan.resumeDecision, "BLOCKED");
  assert.equal(result.recoveryPlan.resumeExecutionAllowed, false);
});

test("#429/#430 adapter never bypasses authorization or local/test-only boundary", async () => {
  const denied = durableFixture([], "employee");
  let auditCalls = 0;
  const localReader = createLocalRecoveryOperationAuditReader(argsFor(denied.db));
  const auditReader = async (environment: Parameters<typeof localReader>[0], at: string) => {
    auditCalls++;
    return localReader(environment, at);
  };
  const response = await handleRecoveryReadinessApi(authenticated(),
    { DB: denied.db, RUNTIME_ENVIRONMENT: "test" }, "forbidden-local",
    liveReadyFixture, auditReader);
  assert.equal(response?.status, 403);
  assert.equal(auditCalls, 0);
  const adminDb = durableFixture().db;
  const onProduction = await handleRecoveryReadinessApi(authenticated(),
    { DB: adminDb, RUNTIME_ENVIRONMENT: "production" }, "cannot-attach-test-adapter",
    liveReadyFixture, createLocalRecoveryOperationAuditReader(argsFor(adminDb)));
  assert.equal(onProduction?.status, 200);
  const prod = await onProduction!.json() as ReturnType<typeof projectRecoveryCenter>;
  assert.equal(prod.recoveryPlan.evidenceSource, "unavailable");
  assert.equal(prod.recoveryPlan.resumeDecision, "BLOCKED");
  assert.equal(prod.restoreGate.executionAllowed, false);
});

test("#430 API Audit corruption stays unavailable, never reported as an authorized resume", async () => {
  const fixture = durableFixture();
  const args = await passUntil(fixture.db, 5);
  fixture.rows[0]!.record_sha256 = "0".repeat(64);
  const response = await handleRecoveryReadinessApi(authenticated(),
    { DB: fixture.db, RUNTIME_ENVIRONMENT: "test" }, "bad-audit",
    liveReadyFixture, createLocalRecoveryOperationAuditReader(args));
  assert.equal(response?.status, 200);
  const view = await response!.json() as ReturnType<typeof projectRecoveryCenter>;
  assert.equal(view.recoveryPlan.evidenceSource, "unavailable");
  assert.equal(view.auditEvidence.status, "UNAVAILABLE");
  assert.equal(view.recoveryPlan.resumeDecision, "BLOCKED");
  assert.equal(view.recoveryPlan.resumeExecutionAllowed, false);
});
