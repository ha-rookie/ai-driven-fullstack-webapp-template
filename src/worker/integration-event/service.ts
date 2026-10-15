import { cryptoIdGenerator, systemClock, type Clock, type IdGenerator } from "../../shared/runtime";
import type {
  IntegrationDeliveryAdapter,
  IntegrationEventPayload,
  IntegrationEventRecord,
  IntegrationEventStore,
  OutboxRecord,
} from "./types";

const TOKEN_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const DESTINATION_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const SENSITIVE_TERMS = ["authorization", "cookie", "credential", "password", "secret", "session", "token"] as const;
const DEFAULT_RETRY_AFTER_MS = 30_000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
// Never persist raw Provider diagnostic text (including credential-like strings).
// Extend this versioned list only after auditing a new provider-neutral code.
const SAFE_DELIVERY_FAILURE_CODES = new Set([
  "event_missing", "delivery_exception", "retryable_failure", "permanent_failure",
  "provider_unavailable", "destination_disabled", "delivery_outcome_unknown",
  "provider_rejected", "temporary", "other",
]);

const assertIdentifier = (value: string, name: string): void => {
  if (!IDENTIFIER_PATTERN.test(value)) throw new TypeError(`${name} must be a bounded opaque identifier`);
};
const assertToken = (value: string, name: string): void => {
  if (!TOKEN_PATTERN.test(value)) throw new TypeError(`${name} must be a bounded lower-case token`);
};
const assertDestination = (value: string): void => {
  if (!DESTINATION_PATTERN.test(value)) throw new TypeError("destinationKey must be a bounded lower-case token");
};
const assertIso = (value: string, name: string): void => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new TypeError(`${name} must be an ISO-8601 UTC timestamp`);
};
const assertPayloadSafe = (payload: IntegrationEventPayload): void => {
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > 64 * 1024) throw new RangeError("integration event payload exceeds 64 KiB");
  for (const key of Object.keys(payload)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (SENSITIVE_TERMS.some((term) => normalized.includes(term))) {
      throw new TypeError(`integration event payload must not contain sensitive field '${key}'`);
    }
  }
};

export interface EnqueueIntegrationEventInput {
  readonly environment: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly destinationKey: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly occurredAt: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly payload: IntegrationEventPayload;
  readonly eventId?: string;
  readonly outboxId?: string;
}

export class IntegrationEventService {
  constructor(
    private readonly store: IntegrationEventStore,
    private readonly clock: Clock = systemClock,
    private readonly idGenerator: IdGenerator = cryptoIdGenerator,
  ) {}

  async enqueue(input: EnqueueIntegrationEventInput): Promise<{ readonly event: IntegrationEventRecord; readonly outbox: OutboxRecord; readonly kind: "created" | "duplicate" }> {
    assertToken(input.eventType, "eventType");
    assertDestination(input.destinationKey);
    if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1 || input.schemaVersion > 1_000) {
      throw new RangeError("schemaVersion must be between 1 and 1000");
    }
    assertIso(input.occurredAt, "occurredAt");
    if (input.aggregateType) assertToken(input.aggregateType, "aggregateType");
    if (input.aggregateId) assertIdentifier(input.aggregateId, "aggregateId");
    if (input.correlationId) assertIdentifier(input.correlationId, "correlationId");
    if (input.causationId) assertIdentifier(input.causationId, "causationId");
    assertPayloadSafe(input.payload);

    const now = this.clock.now().toISOString();
    const eventId = input.eventId ?? this.idGenerator.generate();
    const outboxId = input.outboxId ?? this.idGenerator.generate();
    assertIdentifier(eventId, "eventId");
    assertIdentifier(outboxId, "outboxId");

    const event: IntegrationEventRecord = Object.freeze({
      id: eventId,
      environment: input.environment,
      eventType: input.eventType,
      schemaVersion: input.schemaVersion,
      aggregateType: input.aggregateType ?? null,
      aggregateId: input.aggregateId ?? null,
      occurredAt: input.occurredAt,
      correlationId: input.correlationId ?? null,
      causationId: input.causationId ?? null,
      payload: Object.freeze({ ...input.payload }),
      createdAt: now,
    });
    const outbox: OutboxRecord = Object.freeze({
      id: outboxId,
      environment: input.environment,
      integrationEventId: eventId,
      destinationKey: input.destinationKey,
      status: "pending",
      availableAt: now,
      attemptCount: 0,
      lastAttemptAt: null,
      deliveredAt: null,
      deadLetteredAt: null,
      failureCode: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const kind = await this.store.createEventWithOutbox({ event, outbox });
    return { event, outbox, kind };
  }
}

export type RelayOutboxResult =
  | { readonly kind: "delivered" }
  | { readonly kind: "retryable_failure"; readonly failureCode: string; readonly retryAfterMs: number }
  | { readonly kind: "permanent_failure"; readonly failureCode: string }
  | { readonly kind: "unknown"; readonly failureCode: "delivery_outcome_unknown" }
  | { readonly kind: "duplicate_terminal"; readonly status: "delivered" | "dead_letter" }
  | { readonly kind: "not_due"; readonly retryAfterMs: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "missing" };

const normalizeRetryAfter = (value: number | undefined): number =>
  value === undefined ? DEFAULT_RETRY_AFTER_MS : Math.min(value, MAX_RETRY_AFTER_MS);

// A known discriminator with malformed fields is still an untrusted runtime
// result. Do not interpret an invalid retry hint as a default safe re-send.
const validDeliveryOutcomePayload = (value: Record<string, unknown>): boolean => {
  if (value.kind === "delivered") return true;
  if (value.failureCode !== undefined
    && (typeof value.failureCode !== "string"
      || !SAFE_DELIVERY_FAILURE_CODES.has(value.failureCode))) return false;
  if (value.kind === "retryable_failure") {
    return value.retryAfterMs === undefined || (
      typeof value.retryAfterMs === "number"
      && Number.isSafeInteger(value.retryAfterMs)
      && value.retryAfterMs > 0
    );
  }
  return value.kind === "permanent_failure";
};

export const relayOutboxOnce = async (input: {
  readonly environment: string;
  readonly outboxId: string;
  readonly store: IntegrationEventStore;
  readonly adapter: IntegrationDeliveryAdapter;
  readonly clock?: Clock;
}): Promise<RelayOutboxResult> => {
  const clock = input.clock ?? systemClock;
  const current = await input.store.getOutbox(input.outboxId, input.environment);
  if (!current) return { kind: "missing" };
  if (current.status === "delivered" || current.status === "dead_letter") {
    return { kind: "duplicate_terminal", status: current.status };
  }
  const now = clock.now();
  if (current.availableAt > now.toISOString()) {
    return { kind: "not_due", retryAfterMs: Math.max(1, new Date(current.availableAt).getTime() - now.getTime()) };
  }
  if (current.status === "processing") return { kind: "conflict" };

  const processing: OutboxRecord = {
    ...current,
    status: "processing",
    attemptCount: current.attemptCount + 1,
    lastAttemptAt: now.toISOString(),
    failureCode: null,
    version: current.version + 1,
    updatedAt: now.toISOString(),
  };
  if (!await input.store.compareAndSetOutbox({ record: processing, expectedVersion: current.version, expectedStatus: current.status })) {
    return { kind: "conflict" };
  }

  const event = await input.store.getEvent(processing.integrationEventId, input.environment);
  if (!event) {
    const terminal = { ...processing, status: "dead_letter" as const, deadLetteredAt: clock.now().toISOString(), failureCode: "event_missing", version: processing.version + 1, updatedAt: clock.now().toISOString() };
    await input.store.compareAndSetOutbox({ record: terminal, expectedVersion: processing.version, expectedStatus: "processing" });
    return { kind: "permanent_failure", failureCode: "event_missing" };
  }

  // The adapter may have sent the request before an exception/timeout. Its
  // outcome is UNKNOWN, not a safe automatic retry. Quarantine in the durable
  // dead-letter lane pending independent provider reconciliation; do not infer
  // that the provider rejected the message.
  // Treat runtime-invalid adapter results as UNKNOWN as well. TypeScript
  // declarations cannot guarantee a third-party Provider adapter's return
  // value; an unrecognized kind must never fall through to retry_wait.
  let delivery: Awaited<ReturnType<IntegrationDeliveryAdapter["deliver"]>> = { kind: "unknown" };
  try {
    const candidate: unknown = await input.adapter.deliver({
      event, destinationKey: processing.destinationKey, attempt: processing.attemptCount,
    });
    if (
      candidate !== null && typeof candidate === "object" && "kind" in candidate
      && (candidate.kind === "delivered"
        || candidate.kind === "retryable_failure"
        || candidate.kind === "permanent_failure")
      && validDeliveryOutcomePayload(candidate as Record<string, unknown>)
    ) {
      delivery = candidate as Awaited<ReturnType<IntegrationDeliveryAdapter["deliver"]>>;
    }
  } catch {
    delivery = { kind: "unknown" };
  }

  const completedAt = clock.now();
  if (delivery.kind === "unknown") {
    const unknown: OutboxRecord = {
      ...processing, status: "dead_letter", deadLetteredAt: completedAt.toISOString(),
      failureCode: "delivery_outcome_unknown", version: processing.version + 1,
      updatedAt: completedAt.toISOString(),
    };
    if (!await input.store.compareAndSetOutbox({
      record: unknown, expectedVersion: processing.version, expectedStatus: "processing",
    })) return { kind: "conflict" };
    return { kind: "unknown", failureCode: "delivery_outcome_unknown" };
  }
  if (delivery.kind === "delivered") {
    const delivered: OutboxRecord = { ...processing, status: "delivered", deliveredAt: completedAt.toISOString(), failureCode: null, version: processing.version + 1, updatedAt: completedAt.toISOString() };
    if (!await input.store.compareAndSetOutbox({ record: delivered, expectedVersion: processing.version, expectedStatus: "processing" })) return { kind: "conflict" };
    return { kind: "delivered" };
  }
  if (delivery.kind === "permanent_failure") {
    const failureCode = delivery.failureCode ?? "permanent_failure";
    const failed: OutboxRecord = { ...processing, status: "dead_letter", deadLetteredAt: completedAt.toISOString(), failureCode, version: processing.version + 1, updatedAt: completedAt.toISOString() };
    if (!await input.store.compareAndSetOutbox({ record: failed, expectedVersion: processing.version, expectedStatus: "processing" })) return { kind: "conflict" };
    return { kind: "permanent_failure", failureCode };
  }
  const retryAfterMs = normalizeRetryAfter(delivery.retryAfterMs);
  const failureCode = delivery.failureCode ?? "retryable_failure";
  const retry: OutboxRecord = { ...processing, status: "retry_wait", availableAt: new Date(completedAt.getTime() + retryAfterMs).toISOString(), failureCode, version: processing.version + 1, updatedAt: completedAt.toISOString() };
  if (!await input.store.compareAndSetOutbox({ record: retry, expectedVersion: processing.version, expectedStatus: "processing" })) return { kind: "conflict" };
  return { kind: "retryable_failure", failureCode, retryAfterMs };
};
