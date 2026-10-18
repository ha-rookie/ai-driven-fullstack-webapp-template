import assert from "node:assert/strict";
import test from "node:test";
import { projectRecoveryShowcase } from "../src/reference/admin/recovery-showcase";

const NOW = "2026-10-18T06:00:00.000Z";

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
