import {
  AsyncJobExecutionError,
  createAsyncJobEnvelope,
  type AsyncJobEnvelope,
  type AsyncJobHandler,
} from "../../shared/async-job";
import { systemClock, type Clock, type IdGenerator } from "../../shared/runtime";
import { relayOutboxOnce } from "./service";
import type { IntegrationDeliveryAdapter, IntegrationEventStore } from "./types";

export interface IntegrationOutboxRelayJobPayload {
  readonly environment: string;
  readonly outboxId: string;
}

export const createIntegrationOutboxRelayJobEnvelope = async (input: {
  readonly environment: string;
  readonly outboxId: string;
  readonly correlationId?: string;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
}): Promise<AsyncJobEnvelope<IntegrationOutboxRelayJobPayload>> =>
  createAsyncJobEnvelope({
    type: "integration.outbox_relay",
    payload: { environment: input.environment, outboxId: input.outboxId },
    idempotencyKey: `integration-outbox:${input.environment}:${input.outboxId}`,
    correlationId: input.correlationId,
    clock: input.clock,
    idGenerator: input.idGenerator,
  });

export const createIntegrationOutboxRelayJobHandler = (input: {
  readonly store: IntegrationEventStore;
  readonly adapter: IntegrationDeliveryAdapter;
  readonly clock?: Clock;
}): AsyncJobHandler<IntegrationOutboxRelayJobPayload> => async (payload) => {
  const result = await relayOutboxOnce({
    environment: payload.environment,
    outboxId: payload.outboxId,
    store: input.store,
    adapter: input.adapter,
    clock: input.clock ?? systemClock,
  });

  if (result.kind === "delivered" || result.kind === "duplicate_terminal") return;
  if (result.kind === "retryable_failure") {
    throw new AsyncJobExecutionError({ retryable: true, code: result.failureCode });
  }
  if (result.kind === "not_due") {
    throw new AsyncJobExecutionError({ retryable: true, code: "outbox_not_due" });
  }
  if (result.kind === "conflict") {
    throw new AsyncJobExecutionError({ retryable: true, code: "outbox_conflict" });
  }
  if (result.kind === "missing") {
    throw new AsyncJobExecutionError({ retryable: false, code: "outbox_missing" });
  }
  throw new AsyncJobExecutionError({ retryable: false, code: result.failureCode });
};
