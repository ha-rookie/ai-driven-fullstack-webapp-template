/**
 * #431: provider-neutral Recovery Plan READ MODEL.
 * These are projections of a future audited, persistent Recovery execution,
 * NOT execution commands. The current API deliberately has no registered
 * recovery-operation evidence reader, so no step can appear completed.
 */
import type { RuntimeEnvironment } from "../runtime";
import type { RecoveryReadinessProjection } from "./readiness";

export const RECOVERY_STEPS = [
  { id: "maintenance_mode", label: "Maintenance Mode", phase: "prepare" },
  { id: "stop_scheduled_jobs", label: "Stop Scheduled Jobs", phase: "prepare" },
  { id: "stop_outbound_integrations", label: "Stop Outbound Integrations", phase: "prepare" },
  { id: "select_recovery_point", label: "Select Recovery Point", phase: "prepare" },
  { id: "restore", label: "Restore — Human Gate", phase: "restore" },
  { id: "data_integrity", label: "Data Integrity Check", phase: "verify" },
  { id: "business_consistency", label: "Business Consistency Check", phase: "verify" },
  { id: "integration_reconcile", label: "Integration Reconcile", phase: "verify" },
  { id: "jobs_verify", label: "Jobs Verify", phase: "verify" },
  { id: "application_health", label: "Application Health", phase: "verify" },
  { id: "resume_service", label: "Resume Service — Human Review", phase: "resume" },
] as const;
export type RecoveryStepId = typeof RECOVERY_STEPS[number]["id"];
type PostRestoreCheck = "application" | "dataIntegrity" | "businessConsistency"
  | "integrations" | "jobs" | "security" | "audit";
const CHECK_KEYS: readonly PostRestoreCheck[] = [
  "application", "dataIntegrity", "businessConsistency", "integrations",
  "jobs", "security", "audit",
];
const SCOPE = "workhub-company";
const MAX_CLOCK_SKEW_MS = 300_000;

export interface RecoveryRecordedStep {
  readonly id: Exclude<RecoveryStepId, "resume_service">;
  readonly result: "PASSED" | "FAILED";
  readonly recordedAt: string;
  readonly auditEventId: string;
  /** Approval reference from a trusted Audit adapter; mandatory for Restore. */
  readonly humanApprovalId?: string;
}
export interface RecoveryOperationSnapshot {
  readonly source: "verified-audit";
  readonly scopeId: typeof SCOPE;
  readonly environment: RuntimeEnvironment;
  readonly incidentId: string;
  readonly runId: string;
  readonly observedAt: string;
  readonly steps: readonly RecoveryRecordedStep[];
  readonly postRestoreChecks: Readonly<Record<PostRestoreCheck, "PASSED" | "FAILED" | "UNKNOWN">> | null;
}
export type RecoveryStepState = "VERIFIED" | "FAILED" | "PENDING" | "UNKNOWN";
export interface RecoveryPlanProjection {
  readonly evidenceSource: "not-connected" | "unavailable" | "verified-audit";
  readonly incidentId: string | null;
  readonly runId: string | null;
  readonly steps: readonly {
    readonly id: RecoveryStepId;
    readonly label: string;
    readonly phase: "prepare" | "restore" | "verify" | "resume";
    readonly state: RecoveryStepState;
    readonly executionAllowed: false;
    readonly requiresHumanGate: boolean;
  }[];
  readonly postRestore: "PASSED" | "FAILED" | "UNKNOWN";
  readonly resumeDecision: "BLOCKED" | "HUMAN_REVIEW_REQUIRED";
  readonly resumeExecutionAllowed: false;
  readonly blockers: readonly string[];
}

const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const id = (x: unknown): x is string =>
  typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(x);
const validTime = (x: unknown, asOf: string): x is string => {
  if (typeof x !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(x)) return false;
  const ms = Date.parse(x);
  return Number.isFinite(ms) && new Date(ms).toISOString() === x
    && ms <= Date.parse(asOf);
};
const knownEnvironment = (x: unknown): x is RuntimeEnvironment =>
  x === "local" || x === "test" || x === "preview" || x === "production";

/**
 * Enforce an ordered prefix of independently audited checkpoints; one bad/
 * missing audit ref, out-of-order step, stale read or Human Gate omission makes
 * the entire source UNKNOWN. No "resume_service" completion is consumed here.
 */
const validSnapshot = (
  raw: unknown, environment: RuntimeEnvironment, asOf: string,
): raw is RecoveryOperationSnapshot => {
  if (!object(raw) || raw.source !== "verified-audit" || raw.scopeId !== SCOPE
    || !knownEnvironment(raw.environment) || raw.environment !== environment
    || !id(raw.incidentId) || !id(raw.runId) || !validTime(raw.observedAt, asOf)
    || Date.parse(asOf) - Date.parse(raw.observedAt) > MAX_CLOCK_SKEW_MS
    || !Array.isArray(raw.steps) || raw.steps.length > RECOVERY_STEPS.length - 1
    || !("postRestoreChecks" in raw)) return false;
  let previousAt = "";
  for (let i = 0; i < raw.steps.length; i++) {
    const entry: unknown = raw.steps[i];
    if (!object(entry) || entry.id !== RECOVERY_STEPS[i]?.id
      || !["PASSED", "FAILED"].includes(String(entry.result))
      || !id(entry.auditEventId) || !validTime(entry.recordedAt, raw.observedAt)
      || (previousAt !== "" && entry.recordedAt <= previousAt)
      || (i > 0 && (raw.steps[i - 1] as Record<string, unknown>).result !== "PASSED")) {
      return false;
    }
    // Step 5 represents an approved Restore, not an implicit API capability.
    if (entry.id === "restore" && !id(entry.humanApprovalId)) return false;
    previousAt = entry.recordedAt;
  }
  if (raw.postRestoreChecks !== null) {
    if (!object(raw.postRestoreChecks)
      || !CHECK_KEYS.every(k => ["PASSED", "FAILED", "UNKNOWN"]
        .includes(String((raw.postRestoreChecks as Record<string, unknown>)[k])))) return false;
    // Verification cannot be recorded before a successfully audited Restore.
    if (raw.steps.length < 5 || (raw.steps[4] as Record<string, unknown>).result !== "PASSED") return false;
  }
  return true;
};

const blank = (source: "not-connected" | "unavailable"): RecoveryPlanProjection => ({
  evidenceSource: source, incidentId: null, runId: null,
  steps: RECOVERY_STEPS.map(s => ({
    ...s, state: source === "not-connected" ? "PENDING" : "UNKNOWN",
    executionAllowed: false as const, requiresHumanGate: s.id === "restore" || s.id === "resume_service",
  })),
  postRestore: "UNKNOWN", resumeDecision: "BLOCKED", resumeExecutionAllowed: false,
  blockers: [source === "not-connected"
    ? "durable_recovery_audit_not_connected" : "durable_recovery_audit_unavailable"],
});

export const projectRecoveryPlan = (
  readiness: RecoveryReadinessProjection,
  environment: RuntimeEnvironment,
  asOf: string,
  rawAudit: unknown = null,
): RecoveryPlanProjection => {
  if (!validTime(asOf, asOf)) throw new TypeError("Invalid recovery plan observation clock");
  if (rawAudit === null) return blank("not-connected");
  if (!validSnapshot(rawAudit, environment, asOf)) return blank("unavailable");

  const records = rawAudit.steps;
  const states = RECOVERY_STEPS.map((step, i) => {
    const entry = records[i];
    return {
      ...step,
      state: (step.id === "resume_service" ? "PENDING"
        : !entry ? "PENDING" : entry.result === "PASSED" ? "VERIFIED" : "FAILED") as RecoveryStepState,
      executionAllowed: false as const,
      requiresHumanGate: step.id === "restore" || step.id === "resume_service",
    };
  });
  const checks = rawAudit.postRestoreChecks;
  const checkStatuses = checks ? CHECK_KEYS.map(k => checks[k]) : [];
  const postRestore = checks === null ? "UNKNOWN"
    : checkStatuses.includes("FAILED") ? "FAILED"
      : checkStatuses.every(x => x === "PASSED") ? "PASSED" : "UNKNOWN";
  const blockers: string[] = [];
  if (records.length < 10 || records.some(s => s.result !== "PASSED")) {
    blockers.push("recovery_steps_not_verified");
  }
  if (postRestore !== "PASSED") blockers.push("incident_post_restore_checks_incomplete");
  // A successful rehearsal (readiness) is NOT an incident restore or authority
  // to resume. In addition to incident evidence, require a verified point.
  if (readiness.readiness !== "READY") blockers.push("recovery_readiness_not_verified");
  if (readiness.sourceState !== "available" || readiness.recoveryPoint?.verified !== true) {
    blockers.push("recovery_point_not_verified");
  }
  const possibleReview = blockers.length === 0;
  return {
    evidenceSource: "verified-audit",
    incidentId: rawAudit.incidentId, runId: rawAudit.runId,
    steps: states, postRestore,
    // HUMAN_REVIEW_REQUIRED is a *request for a separate decision*, never
    // permission for RESTORE or RESUME and not a NORMAL health state.
    resumeDecision: possibleReview ? "HUMAN_REVIEW_REQUIRED" : "BLOCKED",
    resumeExecutionAllowed: false, blockers,
  };
};
