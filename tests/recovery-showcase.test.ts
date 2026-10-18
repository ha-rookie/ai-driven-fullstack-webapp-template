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
