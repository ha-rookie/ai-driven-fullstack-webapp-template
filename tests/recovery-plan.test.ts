import assert from "node:assert/strict";
import test from "node:test";
import { projectRecoveryPlan, RECOVERY_STEPS, type RecoveryOperationSnapshot } from "../src/shared/recovery/recovery-plan";
import { assessRecoveryReadiness, type RecoveryObservation } from "../src/shared/recovery/readiness";

const NOW = "2026-10-18T06:00:00.000Z";
const RP = "2026-10-18T05:30:00.000Z";
const makeReady = () => assessRecoveryReadiness({
  sourceState: "available", observationComplete: true,
  observedAt: "2026-10-18T05:59:30.000Z",
  backup: { lastSuccessfulAt: RP, lastVerifiedAt: "2026-10-18T05:31:00.000Z" },
  recoveryPoint: { at: RP, verified: true },
  targets: { rpoMinutes: 60, rtoMinutes: 45, restoreMaxAgeHours: 24 },
  restore: { completedAt: "2026-10-18T05:45:00.000Z", testedRecoveryPointAt: RP,
    result: "PASSED", durationMinutes: 30,
    checks: { application: "PASSED", dataIntegrity: "PASSED", businessConsistency: "PASSED",
      integrations: "PASSED", jobs: "PASSED", security: "PASSED", audit: "PASSED" } },
} satisfies RecoveryObservation, NOW);
const makeRun = (): RecoveryOperationSnapshot => ({
  source: "verified-audit", scopeId: "workhub-company", environment: "production",
  incidentId: "incident-42", runId: "recovery-run-42",
  observedAt: "2026-10-18T05:59:30.000Z",
  steps: RECOVERY_STEPS.slice(0, 10).map((step, i) => ({
    id: step.id as Exclude<typeof step.id, "resume_service">,
    result: "PASSED" as const,
    recordedAt: "2026-10-18T05:" + String(30 + i).padStart(2, "0") + ":00.000Z",
    auditEventId: "audit-" + i,
    ...(step.id === "restore" ? { humanApprovalId: "approval-restore-42" } : {}),
  })),
  postRestoreChecks: { application: "PASSED", dataIntegrity: "PASSED",
    businessConsistency: "PASSED", integrations: "PASSED", jobs: "PASSED",
    security: "PASSED", audit: "PASSED" },
});

test("#431 documented Recovery Plan uses original eleven ordered, provider-neutral steps", () => {
  assert.deepEqual(RECOVERY_STEPS.map(x => x.id), [
    "maintenance_mode", "stop_scheduled_jobs", "stop_outbound_integrations",
    "select_recovery_point", "restore", "data_integrity", "business_consistency",
    "integration_reconcile", "jobs_verify", "application_health", "resume_service",
  ]);
  assert.equal(RECOVERY_STEPS[4]?.phase, "restore");
  assert.equal(RECOVERY_STEPS[10]?.phase, "resume");
});

test("#430 Golden #8: unconnected recovery audit is never silently completed or resumable", () => {
  const view = projectRecoveryPlan(makeReady(), "production", NOW);
  assert.equal(view.evidenceSource, "not-connected");
  assert.equal(view.steps.length, 11);
  assert.ok(view.steps.every(s => s.state === "PENDING" && s.executionAllowed === false));
  assert.equal(view.postRestore, "UNKNOWN");
  assert.equal(view.resumeDecision, "BLOCKED");
  assert.equal(view.resumeExecutionAllowed, false);
  assert.ok(view.blockers.includes("durable_recovery_audit_not_connected"));
});

test("#430 interrupted recovery: ordered trusted checkpoint projection reconstructs without execution", () => {
  const r = makeRun();
  const snapshot = { ...r, steps: r.steps.slice(0, 4), postRestoreChecks: null };
  const first = projectRecoveryPlan(makeReady(), "production", NOW, snapshot);
  const afterBrowserRestart = projectRecoveryPlan(makeReady(), "production", NOW, snapshot);
  assert.deepEqual(first, afterBrowserRestart, "projection is deterministic from the same durable snapshot");
  assert.equal(first.steps.filter(s => s.state === "VERIFIED").length, 4);
  assert.equal(first.steps[4]?.state, "PENDING");
  assert.equal(first.resumeDecision, "BLOCKED");
  assert.ok(first.blockers.includes("recovery_steps_not_verified"));
  assert.equal(first.resumeExecutionAllowed, false);
  // This is a projection-only fixture. No persisted recovery adapter exists yet.
});

test("#429 Production Restore is never accepted without separately recorded Human approval", () => {
  const run = makeRun();
  const partial = { ...run, steps: run.steps.slice(0, 5), postRestoreChecks: null };
  const missingApproval = { ...partial, steps: partial.steps.map(s =>
    s.id === "restore" ? { ...s, humanApprovalId: undefined } : s) };
  assert.equal(projectRecoveryPlan(makeReady(), "production", NOW, missingApproval).evidenceSource, "unavailable");
  const accepted = projectRecoveryPlan(makeReady(), "production", NOW, partial);
  assert.equal(accepted.steps[4]?.state, "VERIFIED");
  assert.equal(accepted.steps[4]?.requiresHumanGate, true);
  assert.equal(accepted.resumeDecision, "BLOCKED");
  assert.equal(accepted.resumeExecutionAllowed, false);
});

test("#430 Golden #8: all ten audited checkpoints and seven incident checks require separate HUMAN review", () => {
  const p = projectRecoveryPlan(makeReady(), "production", NOW, makeRun());
  assert.equal(p.evidenceSource, "verified-audit");
  assert.equal(p.steps.slice(0, 10).filter(x => x.state === "VERIFIED").length, 10);
  assert.equal(p.steps[10]?.state, "PENDING");
  assert.equal(p.postRestore, "PASSED");
  assert.equal(p.resumeDecision, "HUMAN_REVIEW_REQUIRED");
  assert.equal(p.resumeExecutionAllowed, false, "even a fully verified recovery run cannot auto-resume");
  assert.deepEqual(p.blockers, []);
});

test("#430 failure after restore, UNKNOWN audit check and rehearsal UNKNOWN prevent review", () => {
  const r = makeRun();
  const failed = projectRecoveryPlan(makeReady(), "production", NOW, {
    ...r, postRestoreChecks: { ...r.postRestoreChecks, integrations: "FAILED" },
  });
  assert.equal(failed.postRestore, "FAILED");
  assert.equal(failed.resumeDecision, "BLOCKED");
  const unknown = projectRecoveryPlan(makeReady(), "production", NOW, {
    ...r, postRestoreChecks: { ...r.postRestoreChecks, audit: "UNKNOWN" },
  });
  assert.equal(unknown.postRestore, "UNKNOWN");
  assert.equal(unknown.resumeDecision, "BLOCKED");
  const noReadiness = projectRecoveryPlan(assessRecoveryReadiness(null, NOW), "production", NOW, r);
  assert.equal(noReadiness.resumeDecision, "BLOCKED");
  assert.ok(noReadiness.blockers.includes("recovery_readiness_not_verified"));
});

test("#430 stale, reordered, duplicated, cross-scope, absent audit or illegal resume records fail closed", () => {
  const r = makeRun();
  const bad: unknown[] = [
    {}, undefined,
    { ...r, scopeId: "other-tenant" },
    { ...r, environment: "preview" },
    { ...r, observedAt: "2026-10-18T05:45:00.000Z" },
    { ...r, steps: r.steps.slice(1) },
    { ...r, steps: [r.steps[0], r.steps[0]] },
    { ...r, steps: r.steps.map((s, i) => i === 3 ? { ...s, auditEventId: "" } : s) },
    { ...r, steps: r.steps.map((s, i) => i === 2 ? { ...s, recordedAt: "2026-10-18T05:10:00.000Z" } : s) },
    { ...r, steps: [...r.steps, { id: "resume_service", result: "PASSED",
      recordedAt: "2026-10-18T05:45:00.000Z", auditEventId: "unapproved" }] },
    { ...r, steps: [ { ...r.steps[0], result: "FAILED" }, ...r.steps.slice(1) ] },
    { ...r, postRestoreChecks: { application: "PASSED" } },
    { ...r, steps: [], postRestoreChecks: r.postRestoreChecks },
  ];
  for (const value of bad) {
    const p = projectRecoveryPlan(makeReady(), "production", NOW, value);
    assert.equal(p.evidenceSource, "unavailable");
    assert.equal(p.resumeDecision, "BLOCKED");
    assert.ok(p.steps.every(s => s.state === "UNKNOWN" && s.executionAllowed === false));
  }
});

test("#430 a valid FAILED recovery step blocks successor and service resume", () => {
  const r = makeRun();
  const first = { ...r, steps: [{ ...r.steps[0]!, result: "FAILED" as const }], postRestoreChecks: null };
  const p = projectRecoveryPlan(makeReady(), "production", NOW, first);
  assert.equal(p.evidenceSource, "verified-audit");
  assert.equal(p.steps[0]?.state, "FAILED");
  assert.equal(p.steps[1]?.state, "PENDING");
  assert.equal(p.resumeDecision, "BLOCKED");
});
