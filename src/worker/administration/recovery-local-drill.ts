/**
 * #431 — Local/test ONLY persisted recovery rehearsal. It is not a Provider
 * restore, a Production approval, or an executable recovery operation.
 * Records replay through the existing signed D1 durable Audit store and the
 * existing Recovery Plan read model. No HTTP route is registered.
 */
import type { RuntimeEnvironment } from "../../shared/runtime";
import { RECOVERY_STEPS, type RecoveryOperationSnapshot, type RecoveryRecordedStep,
  type RecoveryStepId } from "../../shared/recovery/recovery-plan";
import { D1DurableAuditStore } from "../audit";

const SCOPE = "workhub-company";
const PATH = "/internal/local-recovery-drill";
const PREFIX = "recovery.local-drill.";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CHECK_IDS = RECOVERY_STEPS.slice(0, 10);
const MAX_AUDIT_ROWS = 20;
const validId = (value: string): boolean => ID.test(value);
const fixtureOnly = (environment: RuntimeEnvironment): void => {
  if (environment !== "local" && environment !== "test") {
    throw new Error("Recovery rehearsal audit is local/test-only");
  }
};
const identity = (runId: string, incidentId: string): void => {
  if (!validId(runId) || !validId(incidentId)) throw new TypeError("Invalid drill identifiers");
};
const iso = (value: string): boolean => {
  const date = Date.parse(value);
  return Number.isFinite(date) && new Date(date).toISOString() === value;
};

export interface LocalRecoveryDrillArgs {
  readonly db: D1Database;
  readonly environment: RuntimeEnvironment;
  readonly incidentId: string;
  readonly runId: string;
}

/** Re-read after process/browser restart; never accept caller-supplied "verified" state. */
export const readLocalRecoveryDrill = async (
  args: LocalRecoveryDrillArgs, asOf: string,
): Promise<RecoveryOperationSnapshot | null> => {
  fixtureOnly(args.environment);
  identity(args.runId, args.incidentId);
  if (!iso(asOf)) throw new TypeError("Invalid drill timestamp");
  const page = await new D1DurableAuditStore(args).search({
    scopeId: SCOPE, resourceType: "recovery", resourceId: args.incidentId,
    requestId: args.runId, limit: MAX_AUDIT_ROWS,
  });
  if (page.nextCursor !== null || page.items.length > 10) {
    throw new Error("Duplicate or overflowed recovery drill Audit");
  }
  if (page.items.length === 0) return null;
  const records = [...page.items].reverse();
  const steps: RecoveryRecordedStep[] = [];
  let lastAt = "";
  for (const [index, item] of records.entries()) {
    const record = item.record;
    const expected = CHECK_IDS[index];
    if (!expected || record.kind !== "audit" || record.category !== "system"
      || record.method !== "POST" || record.path !== PATH
      || record.action !== PREFIX + expected.id
      || record.scopeId !== SCOPE || record.resourceType !== "recovery"
      || record.resourceId !== args.incidentId || record.requestId !== args.runId
      || (record.outcome !== "success" && record.outcome !== "failure")
      || !iso(record.timestamp) || record.timestamp > asOf
      || (lastAt !== "" && record.timestamp <= lastAt)
      || (index > 0 && steps[index - 1]?.result !== "PASSED")) {
      throw new Error("Inconsistent recovery drill Audit");
    }
    const approval = record.reason;
    if (expected.id === "restore") {
      if (!approval || !approval.startsWith("SIMULATED-") || !validId(approval)) {
        throw new Error("Missing simulated Human Gate evidence");
      }
    } else if (approval !== undefined) {
      throw new Error("Unexpected recovery drill approval metadata");
    }
    steps.push({
      id: expected.id as Exclude<RecoveryStepId, "resume_service">,
      result: record.outcome === "success" ? "PASSED" : "FAILED",
      recordedAt: record.timestamp,
      auditEventId: item.id,
      ...(expected.id === "restore" ? { humanApprovalId: approval } : {}),
    });
    lastAt = record.timestamp;
  }

  // The seven statuses are a synthetic rehearsal projection, never real
  // Production health, security or Audit compliance evidence.
  const check = (index: number): "PASSED" | "FAILED" | "UNKNOWN" =>
    steps[index]?.result ?? "UNKNOWN";
  const complete = steps.length === 10 && steps.every(step => step.result === "PASSED");
  const postRestoreChecks = steps.length < 5 ? null : {
    application: check(9), dataIntegrity: check(5), businessConsistency: check(6),
    integrations: check(7), jobs: check(8),
    security: complete ? "PASSED" as const : "UNKNOWN" as const,
    audit: complete ? "PASSED" as const : "UNKNOWN" as const,
  };
  return {
    source: "verified-audit", scopeId: SCOPE, environment: args.environment,
    incidentId: args.incidentId, runId: args.runId, observedAt: asOf,
    steps, postRestoreChecks,
  };
};

export interface LocalRecoveryDrillStep {
  readonly id: Exclude<RecoveryStepId, "resume_service">;
  readonly result: "PASSED" | "FAILED";
  /** Explicit mock approval marker; NEVER a real Production approval. */
  readonly simulatedApprovalId?: string;
}

/** Internal local harness only. One ordered checkpoint per call; fail closed. */
export const appendLocalRecoveryDrillStep = async (
  args: LocalRecoveryDrillArgs, step: LocalRecoveryDrillStep,
  recordedAt: string,
): Promise<void> => {
  fixtureOnly(args.environment);
  identity(args.runId, args.incidentId);
  if (!iso(recordedAt)) throw new TypeError("Invalid checkpoint time");
  const previous = await readLocalRecoveryDrill(args, recordedAt);
  const next = CHECK_IDS[previous?.steps.length ?? 0];
  if (!next || next.id !== step.id
    || (previous !== null && previous.steps.at(-1)?.result !== "PASSED")
    || (previous !== null && previous.steps.at(-1)!.recordedAt >= recordedAt)) {
    throw new Error("Recovery drill checkpoint is out of order or terminal");
  }
  if (step.id === "restore") {
    if (!step.simulatedApprovalId?.startsWith("SIMULATED-")
      || !validId(step.simulatedApprovalId)) {
      throw new Error("Mock Restore cannot skip its simulated Human Gate");
    }
  } else if (step.simulatedApprovalId !== undefined) {
    throw new Error("Only Restore accepts simulated approval");
  }
  await new D1DurableAuditStore({
    db: args.db, environment: args.environment,
    clock: { now: () => new Date(recordedAt) },
  }).append({
    requestId: args.runId, method: "POST", path: PATH,
    category: "system", action: PREFIX + step.id,
    outcome: step.result === "PASSED" ? "success" : "failure",
    scopeId: SCOPE, resourceType: "recovery", resourceId: args.incidentId,
    reason: step.simulatedApprovalId,
  });
  // Concurrent duplicate calls cannot be atomically coordinated by the Audit
  // API; an inconsistent replay must fail closed instead of granting resume.
};

/**
 * Opt-in integration adapter for an authorized Recovery Readiness GET in
 * local/test. Never register this factory in Preview/Production composition.
 * The caller must still pass the normal authentication and scope gates before
 * this reader is called; it has no capability to execute Restore/Resume.
 */
export const createLocalRecoveryOperationAuditReader = (
  args: Omit<LocalRecoveryDrillArgs, "environment">,
): ((environment: RuntimeEnvironment, asOf: string) => Promise<RecoveryOperationSnapshot | null>) =>
  (environment, asOf) => readLocalRecoveryDrill({ ...args, environment }, asOf);
