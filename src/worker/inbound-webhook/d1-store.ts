import type {
  InboundWebhookReceiptRecord,
  InboundWebhookReceiptStatus,
  InboundWebhookReceiptStore,
} from "./types";

interface InboundWebhookReceiptRow {
  id: string;
  environment: string;
  provider_key: string;
  provider_event_id: string | null;
  replay_key: string;
  event_type: string;
  occurred_at: string | null;
  received_at: string;
  status: InboundWebhookReceiptStatus;
  attempt_count: number;
  failure_code: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const mapRow = (row: InboundWebhookReceiptRow): InboundWebhookReceiptRecord => ({
  id: row.id,
  environment: row.environment,
  providerKey: row.provider_key,
  providerEventId: row.provider_event_id,
  replayKey: row.replay_key,
  eventType: row.event_type,
  occurredAt: row.occurred_at,
  receivedAt: row.received_at,
  status: row.status,
  attemptCount: row.attempt_count,
  failureCode: row.failure_code,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});

const isConstraintError = (error: unknown) =>
  error instanceof Error && /UNIQUE constraint failed|constraint failed/iu.test(error.message);

export class D1InboundWebhookReceiptStore implements InboundWebhookReceiptStore {
  constructor(private readonly db: D1Database) {}

  async create(record: InboundWebhookReceiptRecord): Promise<"created" | "duplicate"> {
    try {
      await this.db.prepare(`INSERT INTO inbound_webhook_receipts (
        id, environment, provider_key, provider_event_id, replay_key, event_type,
        occurred_at, received_at, status, attempt_count, failure_code, version,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          record.id,
          record.environment,
          record.providerKey,
          record.providerEventId,
          record.replayKey,
          record.eventType,
          record.occurredAt,
          record.receivedAt,
          record.status,
          record.attemptCount,
          record.failureCode,
          record.version,
          record.createdAt,
          record.updatedAt,
          record.completedAt,
        )
        .run();
      return "created";
    } catch (error) {
      if (isConstraintError(error)) return "duplicate";
      throw error;
    }
  }

  async get(id: string, environment: string): Promise<InboundWebhookReceiptRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM inbound_webhook_receipts WHERE id = ? AND environment = ?",
    ).bind(id, environment).first<InboundWebhookReceiptRow>();
    return row ? mapRow(row) : null;
  }

  async getByReplayKey(
    environment: string,
    providerKey: string,
    replayKey: string,
  ): Promise<InboundWebhookReceiptRecord | null> {
    const row = await this.db.prepare(
      "SELECT * FROM inbound_webhook_receipts WHERE environment = ? AND provider_key = ? AND replay_key = ?",
    ).bind(environment, providerKey, replayKey).first<InboundWebhookReceiptRow>();
    return row ? mapRow(row) : null;
  }

  async compareAndSet(input: {
    readonly record: InboundWebhookReceiptRecord;
    readonly expectedVersion: number;
    readonly expectedStatus: InboundWebhookReceiptStatus;
  }): Promise<boolean> {
    const record = input.record;
    const result = await this.db.prepare(`UPDATE inbound_webhook_receipts
      SET status = ?, attempt_count = ?, failure_code = ?, version = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND environment = ? AND version = ? AND status = ?`)
      .bind(
        record.status,
        record.attemptCount,
        record.failureCode,
        record.version,
        record.updatedAt,
        record.completedAt,
        record.id,
        record.environment,
        input.expectedVersion,
        input.expectedStatus,
      )
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }
}
