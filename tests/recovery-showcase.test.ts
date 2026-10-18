import assert from "node:assert/strict";
import test from "node:test";
import { projectRecoveryShowcase, RECOVERY_SHOWCASE_SCENARIOS, RECOVERY_SHOWCASE_FAILURES } from "../src/reference/admin/recovery-showcase";

const NOW = "2026-10-18T06:00:00.000Z";

test("#431 showcase covers six distinct original recovery decisions using actual evaluator", () => {
  const cases = {
    ready: ["READY", "WITHIN_TARGET", "CURRENT", "PASSED", false],
    rpo_breach: ["NOT_READY", "BREACHED", "CURRENT", "PASSED", true],
    restore_failed: ["NOT_READY", "WITHIN_TARGET", "FAILED", "FAILED", true],
    restore_stale: ["NOT_READY", "BREACHED", "STALE", "PASSED", true],
    restore_missing: ["UNKNOWN", "WITHIN_TARGET", "MISSING", "UNKNOWN", false],
    not_connected: ["UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", false],
  } as const;
  assert.equal(RECOVERY_SHOWCASE_SCENARIOS.length, 6);
  for (const scenario of RECOVERY_SHOWCASE_SCENARIOS) {
    const result = projectRecoveryShowcase(scenario.id, NOW);
    const expected = cases[scenario.id];
    assert.deepEqual([
      result.recovery.readiness, result.recovery.rpo.status,
      result.recovery.restoreFreshness, result.recovery.postRestoreVerification,
      result.actionRequired,
    ], expected, scenario.id);
    assert.equal(result.restoreExecutionAllowed, false);
    assert.equal(result.resumeExecutionAllowed, false);
    assert.equal(result.recoveryPlan.steps.length, 11);
    assert.ok(result.recoveryPlan.steps.every(step => step.executionAllowed === false));
    assert.equal(result.recoveryPlan.resumeExecutionAllowed, false);
  }
});

test("#430 a demo with successful backup alone never becomes Recovery READY", () => {
  const result = projectRecoveryShowcase("restore_missing", NOW);
  assert.equal(result.recovery.protection, "PROTECTED");
  assert.equal(result.recovery.readiness, "UNKNOWN");
  assert.equal(result.recovery.lastRestoreVerifiedAt, null);
  assert.equal(result.recovery.rto.status, "UNKNOWN");
});

test("#431 showcases are pure time-relative simulations, not provider observations or real commands", () => {
  const first = projectRecoveryShowcase("ready", NOW);
  const later = projectRecoveryShowcase("ready", "2026-10-19T06:00:00.000Z");
  assert.equal(first.recovery.rpo.exposureMinutes, 30);
  assert.equal(later.recovery.rpo.exposureMinutes, 30);
  assert.equal(projectRecoveryShowcase("not_connected", NOW).recovery.sourceState, "not-connected");
  assert.equal(projectRecoveryShowcase("rpo_breach", NOW).actionRequired, true);
});

test("#431 showcase reveals which of the seven checks failed, without enabling service resume", () => {
  const failed = projectRecoveryShowcase("restore_failed", NOW);
  assert.equal(failed.recovery.restoreTest?.checks.dataIntegrity, "FAILED");
  assert.equal(failed.recovery.restoreTest?.checks.application, "PASSED");
  assert.equal(Object.keys(failed.recovery.restoreTest!.checks).length, 7);
  const stale = projectRecoveryShowcase("restore_stale", NOW);
  assert.equal(stale.recovery.restoreTest?.checks.audit, "PASSED");
  assert.equal(stale.recovery.restoreFreshness, "STALE");
  assert.equal(projectRecoveryShowcase("restore_missing", NOW).recovery.restoreTest, null);
  assert.equal(projectRecoveryShowcase("not_connected", NOW).recovery.restoreTest, null);
  assert.equal(failed.resumeExecutionAllowed, false);
});

test("#431 showcase runs full 11-step recovery projection and keeps final Human Review", () => {
  const ready = projectRecoveryShowcase("ready", NOW);
  assert.equal(ready.recoveryPlan.evidenceSource, "verified-audit");
  assert.equal(ready.recoveryPlan.steps.slice(0, 10).filter(s => s.state === "VERIFIED").length, 10);
  assert.equal(ready.recoveryPlan.steps[4]?.requiresHumanGate, true);
  assert.equal(ready.recoveryPlan.steps[10]?.state, "PENDING");
  assert.equal(ready.recoveryPlan.resumeDecision, "HUMAN_REVIEW_REQUIRED");
  assert.equal(ready.recoveryPlan.resumeExecutionAllowed, false);
});

test("#430 interrupted restore and failed verification cannot resume service", () => {
  const interrupted = projectRecoveryShowcase("restore_missing", NOW);
  assert.equal(interrupted.recoveryPlan.steps.filter(s => s.state === "VERIFIED").length, 4);
  assert.equal(interrupted.recoveryPlan.steps[4]?.state, "PENDING");
  assert.equal(interrupted.recoveryPlan.resumeDecision, "BLOCKED");
  assert.deepEqual(interrupted.recoveryPlan, projectRecoveryShowcase("restore_missing", NOW).recoveryPlan);
  const failed = projectRecoveryShowcase("restore_failed", NOW);
  assert.equal(failed.recoveryPlan.steps[6]?.state, "FAILED");
  assert.equal(failed.recoveryPlan.steps[7]?.state, "PENDING");
  assert.equal(failed.recoveryPlan.postRestore, "FAILED");
  assert.equal(failed.recoveryPlan.resumeDecision, "BLOCKED");
  assert.equal(projectRecoveryShowcase("not_connected", NOW).recoveryPlan.evidenceSource, "not-connected");
});

test("#431 RPO breach or stale test blocks resume despite synthetic audited checkpoints", () => {
  for (const scenario of ["rpo_breach", "restore_stale"] as const) {
    const view = projectRecoveryShowcase(scenario, NOW);
    assert.equal(view.recoveryPlan.resumeDecision, "BLOCKED");
    assert.ok(view.recoveryPlan.blockers.includes("recovery_readiness_not_verified"));
  }
});

test("#431 target knobs change RPO/RTO verdict and recovery decision using real evaluator", () => {
  const baseline = projectRecoveryShowcase("ready", NOW);
  assert.equal(baseline.recovery.readiness, "READY");
  const strictRpo = projectRecoveryShowcase("ready", NOW, {
    rpoMinutes: 15, rtoMinutes: 45, restoreMaxAgeHours: 24,
  });
  assert.equal(strictRpo.recovery.rpo.status, "BREACHED");
  assert.equal(strictRpo.recovery.readiness, "NOT_READY");
  assert.equal(strictRpo.recoveryPlan.resumeDecision, "BLOCKED");
  assert.equal(strictRpo.actionRequired, true);
  const strictRto = projectRecoveryShowcase("ready", NOW, {
    rpoMinutes: 60, rtoMinutes: 10, restoreMaxAgeHours: 24,
  });
  assert.equal(strictRto.recovery.rto.status, "BREACHED");
  assert.equal(strictRto.recovery.readiness, "NOT_READY");
  assert.equal(strictRto.recoveryPlan.resumeExecutionAllowed, false);
  assert.equal(projectRecoveryShowcase("ready", NOW).recovery.readiness, "READY");
});

test("#431 showcase remains usable without real provider evidence; target changes never authorize restore", () => {
  const targets = { rpoMinutes: 15, rtoMinutes: 10, restoreMaxAgeHours: 1 };
  for (const scenario of RECOVERY_SHOWCASE_SCENARIOS) {
    const result = projectRecoveryShowcase(scenario.id, NOW, targets);
    assert.equal(result.restoreExecutionAllowed, false);
    assert.equal(result.resumeExecutionAllowed, false);
    assert.ok(result.recoveryPlan.steps.every(step => step.executionAllowed === false));
  }
  assert.equal(projectRecoveryShowcase("not_connected", NOW, targets).recovery.sourceState, "not-connected");
});

test("#430 injected audit failure paths fail closed without fake incident completion", () => {
  const normal = projectRecoveryShowcase("ready", NOW);
  assert.equal(normal.recoveryPlan.resumeDecision, "HUMAN_REVIEW_REQUIRED");
  assert.equal(RECOVERY_SHOWCASE_FAILURES.length, 5);
  for (const failure of ["audit_missing", "approval_missing", "audit_stale"] as const) {
    const view = projectRecoveryShowcase("ready", NOW, undefined, failure);
    assert.equal(view.recovery.readiness, "READY", "Rehearsal readiness is not incident audit");
    assert.equal(view.recoveryPlan.evidenceSource, "unavailable", failure);
    assert.equal(view.recoveryPlan.resumeDecision, "BLOCKED", failure);
    assert.equal(view.recoveryPlan.steps.some(step => step.state === "VERIFIED"), false);
    assert.equal(view.recoveryPlan.resumeExecutionAllowed, false);
    assert.ok(view.recoveryPlan.blockers.includes("durable_recovery_audit_unavailable"));
  }
  const unknown = projectRecoveryShowcase("ready", NOW, undefined, "verification_unknown");
  assert.equal(unknown.recoveryPlan.evidenceSource, "verified-audit");
  assert.equal(unknown.recoveryPlan.postRestore, "UNKNOWN");
  assert.equal(unknown.recoveryPlan.resumeDecision, "BLOCKED");
  assert.ok(unknown.recoveryPlan.blockers.includes("incident_post_restore_checks_incomplete"));
  assert.equal(unknown.recoveryPlan.steps[10]?.state, "PENDING");
});

test("#430 cross product: all failure injections and targets never enable restore or resume", () => {
  const targets = { rpoMinutes: 15, rtoMinutes: 10, restoreMaxAgeHours: 1 };
  for (const scenario of RECOVERY_SHOWCASE_SCENARIOS) {
    for (const failure of RECOVERY_SHOWCASE_FAILURES) {
      const view = projectRecoveryShowcase(scenario.id, NOW, targets, failure.id);
      assert.equal(view.restoreExecutionAllowed, false);
      assert.equal(view.resumeExecutionAllowed, false);
      assert.equal(view.recoveryPlan.resumeExecutionAllowed, false);
      assert.ok(view.recoveryPlan.steps.every(step => step.executionAllowed === false));
      if (failure.id !== "none" && scenario.id === "ready") {
        assert.equal(view.recoveryPlan.resumeDecision, "BLOCKED");
      }
    }
  }
});
test("#431/#429 Showcase uses one Finding → ActionRequired rule for Golden #7 and RPO", () => {
  const ready = projectRecoveryShowcase("ready", NOW);
  assert.equal(ready.finding, null);
  assert.equal(ready.reviewAction, null);
  const failed = projectRecoveryShowcase("restore_failed", NOW);
  assert.equal(failed.recovery.protection, "PROTECTED");
  assert.equal(failed.recovery.readiness, "NOT_READY");
  assert.equal(failed.recoveryPlan.postRestore, "FAILED");
  assert.equal(failed.finding?.id, "recovery_restore_verification_failed");
  assert.equal(failed.reviewAction?.findingId, failed.finding?.id);
  assert.equal(failed.reviewAction?.operationId, "recovery.review");
  assert.equal(failed.reviewAction?.reason, "restore_verification_failed_requires_human_review");
  assert.equal(failed.actionRequired, true);
  assert.equal(failed.recoveryPlan.resumeExecutionAllowed, false);
  const breach = projectRecoveryShowcase("rpo_breach", NOW);
  assert.equal(breach.finding?.id, "recovery_rpo_breach");
  assert.equal(breach.reviewAction?.reason, "rpo_breach_requires_human_review");
  assert.equal(breach.reviewAction?.findingId, breach.finding?.id);
  const unknown = projectRecoveryShowcase("not_connected", NOW);
  assert.equal(unknown.finding, null);
  assert.equal(unknown.reviewAction, null);
});

test("#430 Golden #8 production-restore simulation demands Human Gate and a separate resume review", () => {
  const result = projectRecoveryShowcase("ready", NOW);
  assert.equal(result.recoveryPlan.evidenceSource, "verified-audit");
  assert.equal(result.recoveryPlan.steps.filter(s => s.state === "VERIFIED").length, 10);
  assert.equal(result.recoveryPlan.steps[4]?.requiresHumanGate, true);
  assert.equal(result.recoveryPlan.steps[10]?.state, "PENDING");
  assert.equal(result.recoveryPlan.resumeDecision, "HUMAN_REVIEW_REQUIRED");
  assert.equal(result.recoveryPlan.resumeExecutionAllowed, false);
  assert.equal(result.restoreExecutionAllowed, false);
  for (const injection of ["audit_missing", "approval_missing", "audit_stale",
    "verification_unknown"] as const) {
    const stopped = projectRecoveryShowcase("ready", NOW, undefined, injection);
    assert.equal(stopped.recoveryPlan.resumeDecision, "BLOCKED", injection);
    assert.equal(stopped.resumeExecutionAllowed, false);
  }
});
