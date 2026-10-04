import type {
  IntegrationEventPayload,
  IntegrationEventRecord,
  IntegrationEventStore,
  OutboxRecord,
  OutboxStatus,
} from "./types";

interface EventRow {
  id: string; environment: string; event_type: string; schema_version: number;
  aggregate_type: string | null; aggregate_id: string | null; occurred_at: string;
  correlation_id: string | null; causation_id: string | null; payload_json: string; created_at: string;
}
interface OutboxRow {
  id: string; environment: string; integration_event_id: string; destination_key: string;
  status: OutboxStatus; available_at: string; attempt_count: number; last_attempt_at: string | null;
  delivered_at: string | null; dead_lettered_at: string | null; failure_code: string | null;
  version: number; created_at: string; updated_at: string;
}

const mapEvent = (row: EventRow): IntegrationEventRecord => ({
  id: row.id, environment: row.environment, eventType: row.event_type, schemaVersion: row.schema_version,
  aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, occurredAt: row.occurred_at,
  correlationId: row.correlation_id, causationId: row.causation_id,
  payload: JSON.parse(row.payload_json) as IntegrationEventPayload, createdAt: row.created_at,
});
const mapOutbox = (row: OutboxRow): OutboxRecord => ({
  id: row.id, environment: row.environment, integrationEventId: row.integration_event_id,
  destinationKey: row.destination_key, status: row.status, availableAt: row.available_at,
  attemptCount: row.attempt_count, lastAttemptAt: row.last_attempt_at, deliveredAt: row.delivered_at,
  deadLetteredAt: row.dead_lettered_at, failureCode: row.failure_code, version: row.version,
  createdAt: row.created_at, updatedAt: row.updated_at,
});
const duplicate = (error: unknown) => error instanceof Error && /UNIQUE constraint failed|constraint failed/iu.test(error.message);

export class D1IntegrationEventStore implements IntegrationEventStore {
  constructor(private readonly db: D1Database) {}

  async createEventWithOutbox(input: { readonly event: IntegrationEventRecord; readonly outbox: OutboxRecord }) {
    try {
      await this.db.batch([
        this.db.prepare(`INSERT INTO integration_events (
          id, environment, event_type, schema_version, aggregate_type, aggregate_id, occurred_at,
          correlation_id, causation_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(input.event.id, input.event.environment, input.event.eventType, input.event.schemaVersion,
            input.event.aggregateType, input.event.aggregateId, input.event.occurredAt, input.event.correlationId,
            input.event.causationId, JSON.stringify(input.event.payload), input.event.createdAt),
        this.db.prepare(`INSERT INTO integration_outbox (
          id, environment, integration_event_id, destination_key, status, available_at, attempt_count,
          last_attempt_at, delivered_at, dead_lettered_at, failure_code, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(input.outbox.id, input.outbox.environment, input.outbox.integrationEventId,
            input.outbox.destinationKey, input.outbox.status, input.outbox.availableAt, input.outbox.attemptCount,
            input.outbox.lastAttemptAt, input.outbox.deliveredAt, input.outbox.deadLetteredAt,
            input.outbox.failureCode, input.outbox.version, input.outbox.createdAt, input.outbox.updatedAt),
      ]);
      return "created" as const;
    } catch (error) {
      if (duplicate(error)) return "duplicate" as const;
      throw error;
    }
  }

  async getEvent(id: string, environment: string) {
    const row = await this.db.prepare("SELECT * FROM integration_events WHERE id = ? AND environment = ?")
      .bind(id, environment).first<EventRow>();
    return row ? mapEvent(row) : null;
  }

  async getOutbox(id: string, environment: string) {
    const row = await this.db.prepare("SELECT * FROM integration_outbox WHERE id = ? AND environment = ?")
      .bind(id, environment).first<OutboxRow>();
    return row ? mapOutbox(row) : null;
  }

  async listDueOutbox(input: { readonly environment: string; readonly now: string; readonly limit: number }) {
    const result = await this.db.prepare(`SELECT * FROM integration_outbox
      WHERE environment = ? AND status IN ('pending', 'retry_wait') AND available_at <= ?
      ORDER BY available_at ASC, id ASC LIMIT ?`)
      .bind(input.environment, input.now, input.limit).all<OutboxRow>();
    return (result.results ?? []).map(mapOutbox);
  }

  async compareAndSetOutbox(input: { readonly record: OutboxRecord; readonly expectedVersion: number; readonly expectedStatus: OutboxStatus }) {
    const record = input.record;
    const result = await this.db.prepare(`UPDATE integration_outbox SET
      status = ?, available_at = ?, attempt_count = ?, last_attempt_at = ?, delivered_at = ?,
      dead_lettered_at = ?, failure_code = ?, version = ?, updated_at = ?
      WHERE id = ? AND environment = ? AND version = ? AND status = ?`)
      .bind(record.status, record.availableAt, record.attemptCount, record.lastAttemptAt, record.deliveredAt,
        record.deadLetteredAt, record.failureCode, record.version, record.updatedAt,
        record.id, record.environment, input.expectedVersion, input.expectedStatus).run();
    return (result.meta?.changes ?? 0) === 1;
  }
}
