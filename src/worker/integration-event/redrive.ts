import { systemClock, type Clock } from "../../shared/runtime";
import type { IntegrationEventStore, OutboxRecord } from "./types";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const REASON_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;

export interface OutboxRedriveAuthorizationInput {
  readonly environment: string;
  readonly actorId: string;
  readonly reasonCode: string;
  readonly outbox: OutboxRecord;
}

export type OutboxRedriveAuthorizer = (
  input: OutboxRedriveAuthorizationInput,
) => Promise<boolean> | boolean;

export type RedriveDeadLetterResult =
  | {
      readonly kind: "redriven";
      readonly outbox: OutboxRecord;
      readonly evidence: {
        readonly actorId: string;
        readonly reasonCode: string;
        readonly redrivenAt: string;
        readonly outboxId: string;
        readonly integrationEventId: string;
        readonly previousAttemptCount: number;
      };
    }
  | { readonly kind: "denied" }
  | { readonly kind: "not_dead_letter"; readonly status: OutboxRecord["status"] }
  | { readonly kind: "conflict" }
  | { readonly kind: "missing" };

export const redriveDeadLetterOutbox = async (input: {
  readonly environment: string;
  readonly outboxId: string;
  readonly actorId: string;
  readonly reasonCode: string;
  readonly store: IntegrationEventStore;
  readonly authorize: OutboxRedriveAuthorizer;
  readonly clock?: Clock;
}): Promise<RedriveDeadLetterResult> => {
  if (!IDENTIFIER_PATTERN.test(input.actorId)) {
    throw new TypeError("actorId must be a bounded opaque identifier");
  }
  if (!REASON_PATTERN.test(input.reasonCode)) {
    throw new TypeError("reasonCode must be a bounded lower-case token");
  }

  const current = await input.store.getOutbox(input.outboxId, input.environment);
  if (!current) return { kind: "missing" };
  if (current.status !== "dead_letter") {
    return { kind: "not_dead_letter", status: current.status };
  }

  const authorized = await input.authorize({
    environment: input.environment,
    actorId: input.actorId,
    reasonCode: input.reasonCode,
    outbox: current,
  });
  if (!authorized) return { kind: "denied" };

  const now = (input.clock ?? systemClock).now().toISOString();
  const redriven: OutboxRecord = {
    ...current,
    status: "pending",
    availableAt: now,
    deadLetteredAt: null,
    failureCode: null,
    version: current.version + 1,
    updatedAt: now,
  };
  const updated = await input.store.compareAndSetOutbox({
    record: redriven,
    expectedVersion: current.version,
    expectedStatus: "dead_letter",
  });
  if (!updated) return { kind: "conflict" };

  return {
    kind: "redriven",
    outbox: redriven,
    evidence: {
      actorId: input.actorId,
      reasonCode: input.reasonCode,
      redrivenAt: now,
      outboxId: current.id,
      integrationEventId: current.integrationEventId,
      previousAttemptCount: current.attemptCount,
    },
  };
};
