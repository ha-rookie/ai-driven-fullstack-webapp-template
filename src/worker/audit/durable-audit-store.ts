import { redactLogValue } from "../../shared/logging/redaction";
import {
  cryptoIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
  type RuntimeEnvironment,
} from "../../shared/runtime";
import { toStructuredAuditRecord } from "./audit-logger";
import type {
  AuditCategory,
  AuditEvent,
  AuditOutcome,
  StructuredAuditRecord,
} from "./types";

const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_PURGE_BATCH_SIZE = 500;
const MAX_PURGE_BATCH_SIZE = 2000;
const MAX_FILTER_LENGTH = 256;

export type DurableAuditWriteMode = "best_effort" | "required";

export interface DurableAuditSink {
  append(event: AuditEvent): Promise<void>;
}

export interface AuditSearchCursor {
  readonly occurredAt: string;
  readonly id: string;
}

export interface AuditSearchQuery {
  readonly startAt?: string;
  readonly endAt?: string;
  readonly category?: AuditCategory;
  readonly outcome?: AuditOutcome;
  readonly action?: string;
  readonly actorId?: string;
  readonly scopeId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly cursor?: AuditSearchCursor;
  readonly limit?: number;
}

export interface DurableAuditEntry {
  readonly id: string;
  readonly environment: RuntimeEnvironment;
  readonly record: StructuredAuditRecord;
}

export interface DurableAuditSearchResult {
  readonly items: readonly DurableAuditEntry[];
  readonly nextCursor: AuditSearchCursor | null;
}

export interface AuditRetentionPolicy {
  readonly retentionDays: number;
  readonly purgeBatchSize?: number;
}

export interface DurableAuditFailureContext {
  readonly environment: RuntimeEnvironment;
  readonly category: AuditCategory;
  readonly action: string;
  readonly outcome: AuditOutcome;
}

export class DurableAuditIntegrityError extends Error {
  constructor(message = "Durable audit record integrity check failed") {
    super(message);
    this.name = "DurableAuditIntegrityError";
  }
}

export class DurableAuditWriteError extends Error {
  constructor() {
    super("Durable audit write failed");
    this.name = "DurableAuditWriteError";
  }
}

interface DurableAuditRow {
  readonly id: string;
  readonly environment: RuntimeEnvironment;
  readonly occurred_at: string;
  readonly record_json: string;
  readonly record_sha256: string;
}

const assertPositiveInteger = (
  value: number,
  name: string,
  maximum?: number,
): void => {
  if (!Number.isSafeInteger(value) || value <= 0 || (maximum !== undefined && value > maximum)) {
    throw new RangeError(
      maximum === undefined
        ? `${name} must be a positive safe integer`
        : `${name} must be between 1 and ${maximum}`,
    );
  }
};

const assertIsoTimestamp = (value: string, name: string): void => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${name} must be an ISO-8601 UTC timestamp`);
  }
};

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }
  return false;
};

const assertBoundedFilter = (value: string | undefined, name: string): void => {
  if (value === undefined) return;
  if (
    value.length === 0
    || value.length > MAX_FILTER_LENGTH
    || containsControlCharacter(value)
  ) {
    throw new TypeError(`${name} must be a bounded non-control string`);
  }
};

const normalizeSearchLimit = (limit: number | undefined): number => {
  const resolved = limit ?? DEFAULT_SEARCH_LIMIT;
  assertPositiveInteger(resolved, "limit", MAX_SEARCH_LIMIT);
  return resolved;
};

const validateSearchQuery = (query: AuditSearchQuery): number => {
  if (query.startAt !== undefined) assertIsoTimestamp(query.startAt, "startAt");
  if (query.endAt !== undefined) assertIsoTimestamp(query.endAt, "endAt");
  if (query.startAt !== undefined && query.endAt !== undefined && query.startAt > query.endAt) {
    throw new RangeError("startAt must not be after endAt");
  }
  if (query.cursor !== undefined) {
    assertIsoTimestamp(query.cursor.occurredAt, "cursor.occurredAt");
    assertBoundedFilter(query.cursor.id, "cursor.id");
  }

  assertBoundedFilter(query.action, "action");
  assertBoundedFilter(query.actorId, "actorId");
  assertBoundedFilter(query.scopeId, "scopeId");
  assertBoundedFilter(query.resourceType, "resourceType");
  assertBoundedFilter(query.resourceId, "resourceId");

  return normalizeSearchLimit(query.limit);
};

const encodeHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

export const sha256Text = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encodeHex(digest);
};

const serializeDurableAuditRecord = (record: StructuredAuditRecord): string =>
  JSON.stringify(redactLogValue(record));

export const verifyDurableAuditRecord = async (
  recordJson: string,
  expectedSha256: string,
): Promise<StructuredAuditRecord> => {
  const actualSha256 = await sha256Text(recordJson);
  if (actualSha256 !== expectedSha256) {
    throw new DurableAuditIntegrityError();
  }

  try {
    const parsed = JSON.parse(recordJson) as Partial<StructuredAuditRecord>;
    if (
      parsed.kind !== "audit"
      || typeof parsed.timestamp !== "string"
      || typeof parsed.requestId !== "string"
      || typeof parsed.method !== "string"
      || typeof parsed.path !== "string"
      || typeof parsed.category !== "string"
      || typeof parsed.action !== "string"
      || typeof parsed.outcome !== "string"
    ) {
      throw new DurableAuditIntegrityError();
    }
    return parsed as StructuredAuditRecord;
  } catch (error) {
    if (error instanceof DurableAuditIntegrityError) throw error;
    throw new DurableAuditIntegrityError();
  }
};

export interface D1DurableAuditStoreOptions {
  readonly db: D1Database;
  readonly environment: RuntimeEnvironment;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
}

export class D1DurableAuditStore implements DurableAuditSink {
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;

  constructor(private readonly options: D1DurableAuditStoreOptions) {
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? cryptoIdGenerator;
  }

  async append(event: AuditEvent): Promise<void> {
    const occurredAt = this.clock.now().toISOString();
    const record = toStructuredAuditRecord(event, occurredAt);
    const recordJson = serializeDurableAuditRecord(record);
    const recordSha256 = await sha256Text(recordJson);
    const id = this.idGenerator.generate();

    await this.options.db
      .prepare(`
        INSERT INTO durable_audit_events (
          id, environment, occurred_at, request_id, category, action, outcome,
          actor_id, scope_id, resource_type, resource_id,
          record_json, record_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        this.options.environment,
        occurredAt,
        record.requestId,
        record.category,
        record.action,
        record.outcome,
        record.actorId ?? null,
        record.scopeId ?? null,
        record.resourceType ?? null,
        record.resourceId ?? null,
        recordJson,
        recordSha256,
        occurredAt,
      )
      .run();
  }

  async search(query: AuditSearchQuery = {}): Promise<DurableAuditSearchResult> {
    const limit = validateSearchQuery(query);
    const where = ["environment = ?"];
    const values: (string | number | null)[] = [this.options.environment];

    if (query.startAt !== undefined) {
      where.push("occurred_at >= ?");
      values.push(query.startAt);
    }
    if (query.endAt !== undefined) {
      where.push("occurred_at <= ?");
      values.push(query.endAt);
    }
    if (query.category !== undefined) {
      where.push("category = ?");
      values.push(query.category);
    }
    if (query.outcome !== undefined) {
      where.push("outcome = ?");
      values.push(query.outcome);
    }
    if (query.action !== undefined) {
      where.push("action = ?");
      values.push(query.action);
    }
    if (query.actorId !== undefined) {
      where.push("actor_id = ?");
      values.push(query.actorId);
    }
    if (query.scopeId !== undefined) {
      where.push("scope_id = ?");
      values.push(query.scopeId);
    }
    if (query.resourceType !== undefined) {
      where.push("resource_type = ?");
      values.push(query.resourceType);
    }
    if (query.resourceId !== undefined) {
      where.push("resource_id = ?");
      values.push(query.resourceId);
    }
    if (query.cursor !== undefined) {
      where.push("(occurred_at < ? OR (occurred_at = ? AND id < ?))");
      values.push(query.cursor.occurredAt, query.cursor.occurredAt, query.cursor.id);
    }

    values.push(limit);
    const result = await this.options.db
      .prepare(`
        SELECT id, environment, occurred_at, record_json, record_sha256
        FROM durable_audit_events
        WHERE ${where.join(" AND ")}
        ORDER BY occurred_at DESC, id DESC
        LIMIT ?
      `)
      .bind(...values)
      .all<DurableAuditRow>();

    const rows = result.results ?? [];
    const items: DurableAuditEntry[] = [];
    for (const row of rows) {
      if (row.environment !== this.options.environment) {
        throw new DurableAuditIntegrityError("Durable audit environment mismatch");
      }
      items.push({
        id: row.id,
        environment: row.environment,
        record: await verifyDurableAuditRecord(row.record_json, row.record_sha256),
      });
    }

    const last = rows.at(-1);
    return {
      items,
      nextCursor:
        rows.length === limit && last
          ? { occurredAt: last.occurred_at, id: last.id }
          : null,
    };
  }

  async purgeExpired(policy: AuditRetentionPolicy): Promise<number> {
    assertPositiveInteger(policy.retentionDays, "retentionDays");
    const batchSize = policy.purgeBatchSize ?? DEFAULT_PURGE_BATCH_SIZE;
    assertPositiveInteger(batchSize, "purgeBatchSize", MAX_PURGE_BATCH_SIZE);

    const cutoff = new Date(
      this.clock.now().getTime() - policy.retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const result = await this.options.db
      .prepare(`
        DELETE FROM durable_audit_events
        WHERE id IN (
          SELECT id
          FROM durable_audit_events
          WHERE environment = ? AND occurred_at < ?
          ORDER BY occurred_at ASC, id ASC
          LIMIT ?
        )
      `)
      .bind(this.options.environment, cutoff, batchSize)
      .run();

    return result.meta.changes ?? 0;
  }
}

export const writeDurableAudit = async (
  sink: DurableAuditSink,
  event: AuditEvent,
  options: {
    readonly environment: RuntimeEnvironment;
    readonly mode: DurableAuditWriteMode;
    readonly onFailure?: (context: DurableAuditFailureContext) => void;
  },
): Promise<boolean> => {
  try {
    await sink.append(event);
    return true;
  } catch {
    options.onFailure?.({
      environment: options.environment,
      category: event.category,
      action: event.action,
      outcome: event.outcome,
    });
    if (options.mode === "required") {
      throw new DurableAuditWriteError();
    }
    return false;
  }
};
