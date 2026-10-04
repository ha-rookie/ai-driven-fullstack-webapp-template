export type IntegrationEventPayloadValue = string | number | boolean | null;
export type IntegrationEventPayload = Readonly<Record<string, IntegrationEventPayloadValue | readonly IntegrationEventPayloadValue[]>>;

export type OutboxStatus = "pending" | "processing" | "retry_wait" | "delivered" | "dead_letter";

export interface IntegrationEventRecord {
  readonly id: string;
  readonly environment: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string | null;
  readonly aggregateId: string | null;
  readonly occurredAt: string;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly payload: IntegrationEventPayload;
  readonly createdAt: string;
}

export interface OutboxRecord {
  readonly id: string;
  readonly environment: string;
  readonly integrationEventId: string;
  readonly destinationKey: string;
  readonly status: OutboxStatus;
  readonly availableAt: string;
  readonly attemptCount: number;
  readonly lastAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly deadLetteredAt: string | null;
  readonly failureCode: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IntegrationEventStore {
  createEventWithOutbox(input: {
    readonly event: IntegrationEventRecord;
    readonly outbox: OutboxRecord;
  }): Promise<"created" | "duplicate">;
  getEvent(id: string, environment: string): Promise<IntegrationEventRecord | null>;
  getOutbox(id: string, environment: string): Promise<OutboxRecord | null>;
  listDueOutbox(input: {
    readonly environment: string;
    readonly now: string;
    readonly limit: number;
  }): Promise<readonly OutboxRecord[]>;
  compareAndSetOutbox(input: {
    readonly record: OutboxRecord;
    readonly expectedVersion: number;
    readonly expectedStatus: OutboxStatus;
  }): Promise<boolean>;
}

export interface IntegrationDeliveryRequest {
  readonly event: IntegrationEventRecord;
  readonly destinationKey: string;
  readonly attempt: number;
}

export interface IntegrationDeliveryResult {
  readonly kind: "delivered" | "retryable_failure" | "permanent_failure";
  readonly failureCode?: string;
  readonly retryAfterMs?: number;
  readonly providerRequestId?: string;
}

export interface IntegrationDeliveryAdapter {
  deliver(request: IntegrationDeliveryRequest): Promise<IntegrationDeliveryResult>;
}

export interface IntegrationEventMapper<TSourceEvent> {
  map(source: TSourceEvent): Promise<IntegrationEventRecord | null> | IntegrationEventRecord | null;
}
