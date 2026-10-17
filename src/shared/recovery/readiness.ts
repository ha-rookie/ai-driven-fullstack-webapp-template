/**
 * #431 Stage9: provider-neutral *evidence* projection (not a backup provider).
 * No D1, network calls, restoration, or application-specific schema. All inputs
 * are untrusted at the adapter boundary; invalid evidence is UNKNOWN, not READY.
 */
export type ProtectionState = "PROTECTED" | "DEGRADED" | "UNPROTECTED" | "UNKNOWN";
export type RecoveryReadinessState = "READY" | "NOT_READY" | "UNKNOWN";
export type TargetStatus = "WITHIN_TARGET" | "BREACHED" | "UNKNOWN";
export type RestoreFreshness = "CURRENT" | "STALE" | "MISSING" | "FAILED" | "UNKNOWN";
export type RecoverySourceState = "available" | "not-connected" | "unavailable";
type Check = "PASSED" | "FAILED" | "UNKNOWN";
const CHECKS = ["application", "dataIntegrity", "businessConsistency", "integrations",
  "jobs", "security", "audit"] as const;
export type PostRestoreCheck = typeof CHECKS[number];

export interface RecoveryObservation {
  readonly sourceState: "available";
  /** True means the provider adapter completed an authoritative coverage read. */
  readonly observationComplete: true;
  readonly observedAt: string;
  readonly backup: {
    readonly lastSuccessfulAt: string | null;
    readonly lastVerifiedAt: string | null;
  };
  readonly recoveryPoint: {
    readonly at: string;
    readonly verified: boolean;
  } | null;
  readonly targets: {
    readonly rpoMinutes: number;
    readonly rtoMinutes: number;
    readonly restoreMaxAgeHours: number;
  } | null;
  readonly restore: {
    readonly completedAt: string;
    readonly testedRecoveryPointAt: string;
    readonly result: Check;
    readonly durationMinutes: number | null;
    readonly checks: Readonly<Record<PostRestoreCheck, Check>>;
  } | null;
}
export interface RecoveryReadinessProjection {
  readonly sourceState: RecoverySourceState;
  readonly protection: ProtectionState;
  readonly readiness: RecoveryReadinessState;
  readonly rpo: { readonly status: TargetStatus; readonly exposureMinutes: number | null;
    readonly targetMinutes: number | null };
  readonly rto: { readonly status: TargetStatus; readonly measuredMinutes: number | null;
    readonly targetMinutes: number | null };
  readonly restoreFreshness: RestoreFreshness;
  readonly lastSuccessfulBackupAt: string | null;
  readonly lastVerifiedBackupAt: string | null;
  readonly recoveryPoint: { readonly at: string; readonly verified: boolean } | null;
  readonly lastRestoreVerifiedAt: string | null;
  readonly postRestoreVerification: "PASSED" | "FAILED" | "UNKNOWN";
  readonly missingEvidence: readonly string[];
}

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown, asOf: string): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(v)) return false;
  const epoch = Date.parse(v);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === v && v <= asOf;
};
const safeMinutes = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;
const empty = (state: RecoverySourceState): RecoveryReadinessProjection => ({
  sourceState: state, protection: "UNKNOWN", readiness: "UNKNOWN",
  rpo: { status: "UNKNOWN", exposureMinutes: null, targetMinutes: null },
  rto: { status: "UNKNOWN", measuredMinutes: null, targetMinutes: null },
  restoreFreshness: "UNKNOWN", lastSuccessfulBackupAt: null, lastVerifiedBackupAt: null,
  recoveryPoint: null, lastRestoreVerifiedAt: null, postRestoreVerification: "UNKNOWN",
  missingEvidence: ["source_not_verified"],
});
const validObservation = (value: unknown, asOf: string): value is RecoveryObservation => {
  if (!object(value) || value.sourceState !== "available"
    || value.observationComplete !== true || !date(value.observedAt, asOf)
    || !object(value.backup)) return false;
  // Stale observation must not be promoted to a current recovery verdict.
  if (Date.parse(asOf) - Date.parse(value.observedAt) > 300_000) return false;
  const b = value.backup;
  if ((b.lastSuccessfulAt !== null && !date(b.lastSuccessfulAt, value.observedAt))
    || (b.lastVerifiedAt !== null && !date(b.lastVerifiedAt, value.observedAt))
    // Last created and last verified are separate historical records. The most
    // recently verified backup can precede a newer created backup, or its
    // verification can finish after its creation. Both timestamps must be valid.
    || (b.lastVerifiedAt !== null && b.lastSuccessfulAt === null)) return false;
  if (value.recoveryPoint !== null) {
    if (!object(value.recoveryPoint) || !date(value.recoveryPoint.at, value.observedAt)
      || typeof value.recoveryPoint.verified !== "boolean") return false;
  }
  if (value.targets !== null) {
    if (!object(value.targets)
      || !safeMinutes(value.targets.rpoMinutes, 43_200)
      || !safeMinutes(value.targets.rtoMinutes, 10_080)
      || !safeMinutes(value.targets.restoreMaxAgeHours, 8_760)) return false;
  }
  if (value.restore !== null) {
    if (!object(value.restore) || !date(value.restore.completedAt, value.observedAt)
      || !date(value.restore.testedRecoveryPointAt, value.restore.completedAt as string)
      || !["PASSED", "FAILED", "UNKNOWN"].includes(String(value.restore.result))
      || !(value.restore.durationMinutes === null
        || (Number.isSafeInteger(value.restore.durationMinutes)
          && (value.restore.durationMinutes as number) >= 0
          && (value.restore.durationMinutes as number) <= 10_080))
      ) return false;
    const checks = value.restore.checks;
    if (!object(checks) || !CHECKS.every(check =>
      ["PASSED", "FAILED", "UNKNOWN"].includes(String(checks[check])))) return false;
  }
  return true;
};

/** Only a fully verified recovery rehearsal can make readiness READY. */
export const assessRecoveryReadiness = (
  input: unknown, asOf: string,
): RecoveryReadinessProjection => {
  if (!date(asOf, asOf)) throw new TypeError("Invalid recovery observation clock");
  if (input === null) return empty("not-connected");
  if (!validObservation(input, asOf)) return empty("unavailable");

  const b = input.backup, rp = input.recoveryPoint, t = input.targets, test = input.restore;
  const missing: string[] = [];
  const backupKnown = b.lastSuccessfulAt !== null;
  const verifiedBackup = b.lastVerifiedAt !== null;
  const pointVerified = rp !== null && rp.verified;
  const protection: ProtectionState = !backupKnown ? "UNPROTECTED"
    : verifiedBackup && pointVerified ? "PROTECTED" : "DEGRADED";
  if (!verifiedBackup) missing.push("backup_verification_missing");
  if (!pointVerified) missing.push("verified_recovery_point_missing");
  if (!t) missing.push("rpo_rto_targets_missing");
  if (!test) missing.push("restore_verification_missing");

  // Actual measured recovery point age, not a guessed vendor recovery window.
  const exposure = pointVerified
    ? Math.ceil((Date.parse(asOf) - Date.parse(rp.at)) / 60_000) : null;
  const rpoStatus: TargetStatus = exposure === null || t === null ? "UNKNOWN"
    : exposure > t.rpoMinutes ? "BREACHED" : "WITHIN_TARGET";

  const checkResults = test ? CHECKS.map(check => test.checks[check]) : [];
  const postRestore = !test ? "UNKNOWN"
    : test.result === "FAILED" || checkResults.includes("FAILED") ? "FAILED"
      : test.result === "PASSED" && checkResults.every(c => c === "PASSED") ? "PASSED" : "UNKNOWN";

  const aligned = !!test && pointVerified && test.testedRecoveryPointAt === rp.at;
  const tested = test?.result === "PASSED" && postRestore === "PASSED" && aligned;
  const freshness: RestoreFreshness = !test ? "MISSING"
    : postRestore === "FAILED" ? "FAILED"
      : !tested || !t ? "UNKNOWN"
        : Date.parse(asOf) - Date.parse(test.completedAt) > t.restoreMaxAgeHours * 3_600_000
          ? "STALE" : "CURRENT";
  if (test && !aligned) missing.push("tested_recovery_point_unmatched");
  if (freshness === "STALE") missing.push("restore_test_stale");
  if (postRestore !== "PASSED") missing.push("post_restore_verification_incomplete");

  const measured = tested && test?.durationMinutes !== null ? test!.durationMinutes : null;
  const rtoStatus: TargetStatus = measured === null || t === null ? "UNKNOWN"
    : measured > t.rtoMinutes ? "BREACHED" : "WITHIN_TARGET";

  const ready = protection === "PROTECTED" && rpoStatus === "WITHIN_TARGET"
    && rtoStatus === "WITHIN_TARGET" && freshness === "CURRENT"
    && postRestore === "PASSED";
  const confirmedUnsafe = protection === "UNPROTECTED" || rpoStatus === "BREACHED"
    || rtoStatus === "BREACHED" || freshness === "FAILED" || freshness === "STALE";
  const readiness: RecoveryReadinessState = ready ? "READY"
    : confirmedUnsafe ? "NOT_READY" : "UNKNOWN";

  return {
    sourceState: "available", protection, readiness,
    rpo: { status: rpoStatus, exposureMinutes: exposure, targetMinutes: t?.rpoMinutes ?? null },
    rto: { status: rtoStatus, measuredMinutes: measured, targetMinutes: t?.rtoMinutes ?? null },
    restoreFreshness: freshness,
    lastSuccessfulBackupAt: b.lastSuccessfulAt, lastVerifiedBackupAt: b.lastVerifiedAt,
    recoveryPoint: rp, lastRestoreVerifiedAt: tested ? test!.completedAt : null,
    postRestoreVerification: postRestore,
    missingEvidence: missing,
  };
};
