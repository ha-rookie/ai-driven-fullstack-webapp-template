import { systemClock, type Clock } from "../../shared/runtime";
import type { IntegrationEventStore, OutboxRecord } from "./types";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const MAX_AGE_MS = 5 * 60_000;
const ALLOWED_KEYS = new Set([
  "outcome", "proofBasis", "environment", "outboxId", "integrationEventId",
  "destinationKey", "outboxVersion", "checkedAt",
]);

/**
 * Trusted, application-registered Provider-native receipt lookup only.
 * An HTTP 404 or absence from a listing must return unknown, NOT non_delivery.
 * Credential acquisition/connection and source authentication belong to #335.
 */
export interface ProviderReceiptLookup {
  verify(request: {
    readonly environment: string;
    readonly outboxId: string;
    readonly integrationEventId: string;
    readonly destinationKey: string;
    readonly outboxVersion: number;
  }): Promise<unknown>;
}

/** No raw provider payload, receipt identifier or access token is returned. */
export type ProviderReceiptAssessment =
  | { readonly kind: "missing"; readonly manualRetryAllowed: false }
  | { readonly kind: "not_applicable"; readonly manualRetryAllowed: false }
  | { readonly kind: "stale_outbox"; readonly manualRetryAllowed: false }
  | {
      readonly kind: "unverified";
      readonly reason: "provider_not_registered" | "provider_evidence_unavailable";
      readonly manualRetryAllowed: false;
    }
  | {
      readonly kind: "verified_delivery" | "verified_non_delivery";
      readonly checkedAt: string;
      readonly manualRetryAllowed: false;
    };

const unverified = (reason: "provider_not_registered" | "provider_evidence_unavailable") =>
  ({ kind: "unverified", reason, manualRetryAllowed: false } as const);

const plainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;

type VerifiedObservation = {
  readonly outcome: "delivered" | "not_delivered";
  readonly checkedAt: string;
};

const matchingEvidence = (
  value: unknown,
  outbox: OutboxRecord,
  nowMs: number,
): VerifiedObservation | null => {
  try {
    if (!plainRecord(value)) return null;
    if (Object.keys(value).some(key => !ALLOWED_KEYS.has(key))
        || Object.keys(value).length !== ALLOWED_KEYS.size) return null;
    if (value.environment !== outbox.environment
        || value.outboxId !== outbox.id
        || value.integrationEventId !== outbox.integrationEventId
        || value.destinationKey !== outbox.destinationKey
        || value.outboxVersion !== outbox.version) return null;
    // Snapshot untrusted adapter properties once. Re-reading accessors after
    // validation could change a verified non-delivery into a delivery result.
    const outcome = value.outcome;
    const proofBasis = value.proofBasis;
    const checkedAt = value.checkedAt;
    if (outcome !== "delivered" && outcome !== "not_delivered") return null;
    if (outcome === "delivered" && proofBasis !== "authoritative_acceptance_receipt"
        || outcome === "not_delivered" && proofBasis !== "authoritative_terminal_non_delivery"
        || typeof checkedAt !== "string") return null;
    const verifiedTime = Date.parse(checkedAt);
    if (!Number.isFinite(verifiedTime)
        || new Date(verifiedTime).toISOString() !== checkedAt
        || !Number.isFinite(nowMs) || verifiedTime > nowMs
        || nowMs - verifiedTime > MAX_AGE_MS) return null;
    return { outcome, checkedAt };
  } catch {
    // Untrusted JS/provider adapters may return throwing getters or proxies.
    return null;
  }
};

/**
 * Read-only #419 receipt assessment. A verified non-delivery observation is
 * NOT a retry authorization: human policy/audit, durable evidence and #430
 * replay safety would still be required in a separate future operation.
 *
 * This is NOT an HTTP entrypoint: caller must enforce actor/scope permissions.
 */
export const assessOutboxProviderReceipt = async (input: {
  readonly environment: string;
  readonly outboxId: string;
  readonly store: IntegrationEventStore;
  readonly verifier?: ProviderReceiptLookup;
  readonly clock?: Clock;
}): Promise<ProviderReceiptAssessment> => {
  if (!IDENTIFIER.test(input.outboxId) || !IDENTIFIER.test(input.environment)) {
    throw new TypeError("Receipt assessment requires bounded local identifiers");
  }
  const before = await input.store.getOutbox(input.outboxId, input.environment);
  if (!before) return { kind: "missing", manualRetryAllowed: false };
  // Only ambiguous quarantined deliveries are eligible for investigation.
  if (before.status !== "dead_letter" || before.failureCode !== "delivery_outcome_unknown") {
    return { kind: "not_applicable", manualRetryAllowed: false };
  }
  if (!input.verifier) return unverified("provider_not_registered");
  const source = await input.store.getEvent(before.integrationEventId, input.environment);
  if (!source || source.environment !== before.environment
      || source.id !== before.integrationEventId) return unverified("provider_evidence_unavailable");

  let observation: unknown;
  try {
    observation = await input.verifier.verify({
      environment: before.environment, outboxId: before.id,
      integrationEventId: source.id, destinationKey: before.destinationKey,
      outboxVersion: before.version,
    });
  } catch {
    // Never leak provider errors, authorize redrive or mutate the Outbox.
    return unverified("provider_evidence_unavailable");
  }
  const after = await input.store.getOutbox(input.outboxId, input.environment);
  if (!after || after.version !== before.version
      || after.status !== before.status || after.failureCode !== before.failureCode
      || after.integrationEventId !== before.integrationEventId
      || after.destinationKey !== before.destinationKey) {
    return { kind: "stale_outbox", manualRetryAllowed: false };
  }
  const nowMs = (input.clock ?? systemClock).now().getTime();
  const verified = matchingEvidence(observation, before, nowMs);
  if (!verified) return unverified("provider_evidence_unavailable");
  return {
    kind: verified.outcome === "delivered" ? "verified_delivery" : "verified_non_delivery",
    checkedAt: verified.checkedAt,
    manualRetryAllowed: false,
  };
};
