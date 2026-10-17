import assert from "node:assert/strict";
import test from "node:test";
import { assessRecoveryReadiness, type RecoveryObservation } from "../src/shared/recovery/readiness";

const NOW = "2026-10-18T06:00:00.000Z";
const point = "2026-10-18T05:30:00.000Z";
const complete = (): RecoveryObservation => ({
  sourceState: "available", observationComplete: true,
  observedAt: "2026-10-18T05:59:00.000Z",
  backup: { lastSuccessfulAt: point, lastVerifiedAt: point },
  recoveryPoint: { at: point, verified: true },
  targets: { rpoMinutes: 60, rtoMinutes: 45, restoreMaxAgeHours: 24 },
  restore: {
    completedAt: "2026-10-18T05:45:00.000Z", testedRecoveryPointAt: point,
    result: "PASSED", durationMinutes: 25,
    checks: { application: "PASSED", dataIntegrity: "PASSED",
      businessConsistency: "PASSED", integrations: "PASSED",
      jobs: "PASSED", security: "PASSED", audit: "PASSED" },
  },
});

test("#431 unknown provider is not a verified backup, RPO or recovery", () => {
  const p = assessRecoveryReadiness(null, NOW);
  assert.equal(p.sourceState, "not-connected");
  assert.equal(p.protection, "UNKNOWN");
  assert.equal(p.rpo.status, "UNKNOWN");
  assert.equal(p.rto.status, "UNKNOWN");
  assert.equal(p.restoreFreshness, "UNKNOWN");
  assert.equal(p.readiness, "UNKNOWN");
  assert.ok(!JSON.stringify(p).includes('"READY"'));
});

test("#431 genuine all-checked synthetic fixture can reach READY only with matching evidence", () => {
  const p = assessRecoveryReadiness(complete(), NOW);
  assert.equal(p.protection, "PROTECTED");
  assert.deepEqual(p.rpo, { status: "WITHIN_TARGET", exposureMinutes: 30, targetMinutes: 60 });
  assert.deepEqual(p.rto, { status: "WITHIN_TARGET", measuredMinutes: 25, targetMinutes: 45 });
  assert.equal(p.restoreFreshness, "CURRENT");
  assert.equal(p.postRestoreVerification, "PASSED");
  assert.equal(p.readiness, "READY");
  assert.equal(p.missingEvidence.length, 0);
});

test("#430 golden #7: Backup SUCCESS cannot become recoverability verified without restore evidence", () => {
  const b = complete();
  const p = assessRecoveryReadiness({
    ...b, backup: { lastSuccessfulAt: point, lastVerifiedAt: null },
    recoveryPoint: null, restore: null, targets: null,
  }, NOW);
  assert.equal(p.protection, "DEGRADED");
  assert.equal(p.restoreFreshness, "MISSING");
  assert.equal(p.readiness, "UNKNOWN");
  assert.ok(p.missingEvidence.includes("restore_verification_missing"));
  const pointOnly = assessRecoveryReadiness({ ...b, restore: null }, NOW);
  assert.equal(pointOnly.protection, "PROTECTED");
  assert.notEqual(pointOnly.readiness, "READY", "verified backup/point never implies system recovery");
});

test("#430 golden #7: failed or partial post-restore checks block Recovery READY", () => {
  const b = complete();
  const failed = assessRecoveryReadiness({
    ...b, restore: { ...b.restore!, checks: { ...b.restore!.checks, dataIntegrity: "FAILED" } },
  }, NOW);
  assert.equal(failed.restoreFreshness, "FAILED");
  assert.equal(failed.postRestoreVerification, "FAILED");
  assert.equal(failed.readiness, "NOT_READY");
  const unknown = assessRecoveryReadiness({
    ...b, restore: { ...b.restore!, checks: { ...b.restore!.checks, integrations: "UNKNOWN" } },
  }, NOW);
  assert.equal(unknown.postRestoreVerification, "UNKNOWN");
  assert.equal(unknown.readiness, "UNKNOWN");
  const differentPoint = assessRecoveryReadiness({
    ...b, restore: { ...b.restore!, testedRecoveryPointAt: "2026-10-18T04:30:00.000Z" },
  }, NOW);
  assert.equal(differentPoint.readiness, "UNKNOWN");
  assert.ok(differentPoint.missingEvidence.includes("tested_recovery_point_unmatched"));
});

test("#430 RPO breach, measured RTO overrun and stale rehearsal are independent blockers", () => {
  const b = complete();
  const rpo = assessRecoveryReadiness({
    ...b, recoveryPoint: { at: "2026-10-18T03:30:00.000Z", verified: true },
    restore: { ...b.restore!, testedRecoveryPointAt: "2026-10-18T03:30:00.000Z" },
  }, NOW);
  assert.equal(rpo.rpo.status, "BREACHED");
  assert.equal(rpo.readiness, "NOT_READY");
  const rto = assessRecoveryReadiness({
    ...b, restore: { ...b.restore!, durationMinutes: 70 },
  }, NOW);
  assert.equal(rto.rto.status, "BREACHED");
  assert.equal(rto.readiness, "NOT_READY");
  const stalePoint = "2026-10-15T04:00:00.000Z";
  const stale = assessRecoveryReadiness({
    ...b, backup: { lastSuccessfulAt: b.backup.lastSuccessfulAt, lastVerifiedAt: b.backup.lastVerifiedAt },
    recoveryPoint: { at: stalePoint, verified: true },
    restore: { ...b.restore!, completedAt: "2026-10-15T05:00:00.000Z",
      testedRecoveryPointAt: stalePoint },
    targets: { rpoMinutes: 6000, rtoMinutes: 45, restoreMaxAgeHours: 24 },
  }, NOW);
  assert.equal(stale.restoreFreshness, "STALE");
  assert.equal(stale.readiness, "NOT_READY");
});

test("#431 absent backup is UNPROTECTED only from complete source observation", () => {
  const b = complete();
  const p = assessRecoveryReadiness({
    ...b, backup: { lastSuccessfulAt: null, lastVerifiedAt: null },
    recoveryPoint: null, restore: null,
  }, NOW);
  assert.equal(p.protection, "UNPROTECTED");
  assert.equal(p.readiness, "NOT_READY");
  assert.equal(assessRecoveryReadiness({ ...b, observationComplete: false }, NOW).protection, "UNKNOWN");
});

test("#430 malformed/provider failure/future evidence fails closed without leaky raw fields", () => {
  const b = complete();
  const bad = [
    undefined, {}, { ...b, observationComplete: false },
    { ...b, backup: { lastSuccessfulAt: null, lastVerifiedAt: point } },
    { ...b, observedAt: "2099-01-01T00:00:00.000Z" },
    { ...b, observedAt: "2026-10-18T05:45:00.000Z" },
    { ...b, recoveryPoint: { at: "2099-01-01T00:00:00.000Z", verified: true } },
    { ...b, targets: { ...b.targets!, rpoMinutes: -1 } },
    { ...b, restore: { ...b.restore!, checks: { ...b.restore!.checks, audit: "SUCCESS" } } },
    { ...b, restore: { ...b.restore!, durationMinutes: -20 } },
  ];
  for (const input of bad) {
    const p = assessRecoveryReadiness(input, NOW);
    assert.equal(p.sourceState, "unavailable");
    assert.equal(p.readiness, "UNKNOWN");
    assert.equal(p.rpo.status, "UNKNOWN");
    assert.equal(p.lastSuccessfulBackupAt, null);
  }
  assert.throws(() => assessRecoveryReadiness(null, "not-a-date"));
});
