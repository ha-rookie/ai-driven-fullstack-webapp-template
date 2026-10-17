import type { RuntimeEnvironment } from "../../shared/runtime";
import { D1DurableAuditStore } from "../audit";

/**
 * Real, read-only coverage of the existing D1 durable Audit records.
 * This does NOT attest that a backup was verified or a Restore succeeded.
 * The store enforces environment/scope SQL filters and integrity SHA checks.
 */
export interface RecoveryAuditEvidence {
  readonly source: "durable-d1-audit";
  readonly status: "RECORDED" | "NONE" | "UNAVAILABLE";
  /** Number of records validated in this bounded page, not an all-time count. */
  readonly recordsChecked: number | null;
  readonly latestAuditAt: string | null;
  /** Null when the underlying query/validation failed. */
  readonly hasMore: boolean | null;
  readonly provesRecoverability: false;
}

const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;

export const unavailableRecoveryAudit = (): RecoveryAuditEvidence => ({
  source: "durable-d1-audit", status: "UNAVAILABLE",
  recordsChecked: null, latestAuditAt: null, hasMore: null,
  provesRecoverability: false,
});

const validPastTime = (value: string, now: string): boolean => {
  const ms = Date.parse(value);
  return ISO_UTC.test(value) && Number.isFinite(ms)
    && new Date(ms).toISOString() === value && value <= now;
};

/**
 * Called ONLY after the existing HTTP API authenticated and authorized an
 * admin. Does not insert events, restore DB data, or read a backup provider.
 */
export const readRecoveryAuditEvidence = async (
  db: D1Database,
  environment: RuntimeEnvironment,
  observedAt: string,
): Promise<RecoveryAuditEvidence> => {
  try {
    if (!validPastTime(observedAt, observedAt)) return unavailableRecoveryAudit();
    const rows = await new D1DurableAuditStore({ db, environment }).search({
      scopeId: "workhub-company",
      resourceType: "recovery",
      limit: 20,
    });
    if (rows.items.some(item => !validPastTime(item.record.timestamp, observedAt)
      || item.record.scopeId !== "workhub-company"
      || item.record.resourceType !== "recovery"
      || item.environment !== environment)) return unavailableRecoveryAudit();
    const mostRecent = rows.items[0]?.record.timestamp ?? null;
    return {
      source: "durable-d1-audit",
      status: rows.items.length === 0 ? "NONE" : "RECORDED",
      recordsChecked: rows.items.length,
      latestAuditAt: mostRecent,
      hasMore: rows.nextCursor !== null,
      provesRecoverability: false,
    };
  } catch {
    // No false success and no SQL, provider, or secret details in the payload.
    return unavailableRecoveryAudit();
  }
};
