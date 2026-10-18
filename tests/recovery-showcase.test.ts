import assert from "node:assert/strict";
import test from "node:test";
import { projectRecoveryShowcase, RECOVERY_SHOWCASE_SCENARIOS } from "../src/reference/admin/recovery-showcase";

const NOW = "2026-10-18T06:00:00.000Z";

test("#431 showcase covers six distinct original recovery decisions using actual evaluator", () => {
  const cases = {
    ready: ["READY", "WITHIN_TARGET", "CURRENT", "PASSED", false],
    rpo_breach: ["NOT_READY", "BREACHED", "CURRENT", "PASSED", true],
    restore_failed: ["NOT_READY", "WITHIN_TARGET", "FAILED", "FAILED", false],
    restore_stale: ["NOT_READY", "WITHIN_TARGET", "STALE", "PASSED", false],
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

test("#431 public controls use the original RPO/RTO evaluation instead of a precomputed status", () => {
  const defaults = projectRecoveryShowcase("ready", NOW, { rpoMinutes: 60, rtoMinutes: 45 });
  assert.equal(defaults.recovery.readiness, "READY");
  const rpoBreach = projectRecoveryShowcase("ready", NOW, { rpoMinutes: 15, rtoMinutes: 45 });
  assert.equal(rpoBreach.recovery.rpo.status, "BREACHED");
  assert.equal(rpoBreach.recovery.readiness, "NOT_READY");
  assert.equal(rpoBreach.recoveryPlan.resumeDecision, "BLOCKED");
  const rpoBoundary = projectRecoveryShowcase("ready", NOW, { rpoMinutes: 30, rtoMinutes: 45 });
  assert.equal(rpoBoundary.recovery.rpo.status, "WITHIN_TARGET");
  const rtoBreach = projectRecoveryShowcase("ready", NOW, { rpoMinutes: 60, rtoMinutes: 10 });
  assert.equal(rtoBreach.recovery.rto.status, "BREACHED");
  assert.equal(rtoBreach.recoveryPlan.resumeDecision, "BLOCKED");
  assert.equal(rtoBreach.restoreExecutionAllowed, false);
  assert.equal(rtoBreach.resumeExecutionAllowed, false);
  assert.equal(projectRecoveryShowcase("ready", NOW, { rpoMinutes: 60, rtoMinutes: 20 }).recovery.rto.status, "WITHIN_TARGET");
});

test("#431 target controls reject invalid or out-of-range synthetic inputs", () => {
  for (const [rpoMinutes, rtoMinutes] of [
    [0, 45], [-1, 45], [43_201, 45], [30.1, 45], [NaN, 45],
    [60, 0], [60, 10_081], [60, Infinity], [60, 2.5],
  ]) {
    assert.throws(() => projectRecoveryShowcase("ready", NOW, { rpoMinutes, rtoMinutes }), RangeError);
  }
  const unconnected = projectRecoveryShowcase("not_connected", NOW, { rpoMinutes: 60, rtoMinutes: 45 });
  assert.equal(unconnected.recovery.readiness, "UNKNOWN", "targets alone never prove recoverability");
});
