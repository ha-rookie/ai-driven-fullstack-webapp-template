import type { RuntimeEnvironment } from "../runtime";
import {
  retryAfterFromRecord,
  type AsyncJobClaimInput,
  type AsyncJobClaimResult,
  type AsyncJobProgress,
  type AsyncJobRecord,
  type AsyncJobState,
  type AsyncJobStateStore,
} from "./async-job";

interface AsyncJobRow {
  readonly job_id: string;
  readonly job_type: string;
  readonly idempotency_key: string;
  readonly payload_fingerprint: string;
  readonly state: AsyncJobState;
  readonly attempt: number;
  readonly requested_at: string;
  readonly started_at: string | null;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly lease_token: string | null;
  readonly lease_expires_at: string | null;
  readonly next_attempt_at: string | null;
  readonly progress_percent: number | null;
  readonly progress_code: string | null;
  readonly failure_code: string | null;
}

export interface D1AsyncJobStateStoreOptions {
  readonly db: D1Database;
  readonly environment: RuntimeEnvironment;
}

const rowToRecord = (row: AsyncJobRow): AsyncJobRecord => ({
  jobId: row.job_id,
  type: row.job_type,
  idempotencyKey: row.idempotency_key,
  payloadFingerprint: row.payload_fingerprint,
  state: row.state,
  attempt: row.attempt,
  requestedAt: row.requested_at,
  ...(row.started_at === null ? {} : { startedAt: row.started_at }),
  updatedAt: row.updated_at,
  ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  ...(row.lease_token === null ? {} : { leaseToken: row.lease_token }),
  ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: row.lease_expires_at }),
  ...(row.next_attempt_at === null ? {} : { nextAttemptAt: row.next_attempt_at }),
  ...(row.progress_percent === null
    ? {}
    : {
        progress: {
          percent: row.progress_percent,
          ...(row.progress_code === null ? {} : { code: row.progress_code }),
        },
      }),
  ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
});

const positiveRetryAfter = (value: number): number => Math.max(1, value);

export class D1AsyncJobStateStore implements AsyncJobStateStore {
  constructor(private readonly options: D1AsyncJobStateStoreOptions) {}

  private async load(idempotencyKey: string): Promise<AsyncJobRecord | null> {
    const row = await this.options.db
      .prepare(`
        SELECT
          job_id, job_type, idempotency_key, payload_fingerprint,
          state, attempt, requested_at, started_at, updated_at, completed_at,
          lease_token, lease_expires_at, next_attempt_at,
          progress_percent, progress_code, failure_code
        FROM async_job_runs
        WHERE environment = ? AND idempotency_key = ?
        LIMIT 1
      `)
      .bind(this.options.environment, idempotencyKey)
      .first<AsyncJobRow>();

    return row === null ? null : rowToRecord(row);
  }

  private classifyExisting(
    record: AsyncJobRecord,
    input: AsyncJobClaimInput,
  ): Exclude<AsyncJobClaimResult, { readonly kind: "acquired" }> | null {
    if (
      record.type !== input.envelope.type
      || record.payloadFingerprint !== input.envelope.payloadFingerprint
    ) {
      return { kind: "conflict", record };
    }

    if (record.state === "completed") return { kind: "completed", record };
    if (record.state === "failed" || record.state === "dead_letter") {
      return { kind: "terminal", record };
    }

    if (
      record.state === "running"
      && record.leaseExpiresAt !== undefined
      && new Date(record.leaseExpiresAt).getTime() > input.now.getTime()
    ) {
      return {
        kind: "leased",
        record,
        retryAfterMs: positiveRetryAfter(retryAfterFromRecord(record, input.now)),
      };
    }

    if (
      record.state === "retrying"
      && record.nextAttemptAt !== undefined
      && new Date(record.nextAttemptAt).getTime() > input.now.getTime()
    ) {
      return {
        kind: "not_due",
        record,
        retryAfterMs: positiveRetryAfter(retryAfterFromRecord(record, input.now)),
      };
    }

    return null;
  }

  async claim(input: AsyncJobClaimInput): Promise<AsyncJobClaimResult> {
    const nowIso = input.now.toISOString();
    await this.options.db
      .prepare(`
        INSERT OR IGNORE INTO async_job_runs (
          environment, job_id, job_type, idempotency_key, payload_fingerprint,
          state, attempt, requested_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      `)
      .bind(
        this.options.environment,
        input.envelope.jobId,
        input.envelope.type,
        input.envelope.idempotencyKey,
        input.envelope.payloadFingerprint,
        input.envelope.requestedAt,
        nowIso,
      )
      .run();

    const existing = await this.load(input.envelope.idempotencyKey);
    if (existing === null) {
      throw new Error("Async job state disappeared after registration");
    }

    const classified = this.classifyExisting(existing, input);
    if (classified !== null) return classified;

    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
    const result = await this.options.db
      .prepare(`
        UPDATE async_job_runs
        SET
          state = 'running',
          attempt = attempt + 1,
          started_at = COALESCE(started_at, ?),
          updated_at = ?,
          lease_token = ?,
          lease_expires_at = ?,
          next_attempt_at = NULL,
          progress_percent = NULL,
          progress_code = NULL,
          failure_code = NULL
        WHERE environment = ?
          AND idempotency_key = ?
          AND job_type = ?
          AND payload_fingerprint = ?
          AND state IN ('pending', 'retrying', 'running')
          AND (state <> 'running' OR lease_expires_at IS NULL OR lease_expires_at <= ?)
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      `)
      .bind(
        nowIso,
        nowIso,
        input.leaseToken,
        leaseExpiresAt,
        this.options.environment,
        input.envelope.idempotencyKey,
        input.envelope.type,
        input.envelope.payloadFingerprint,
        nowIso,
        nowIso,
      )
      .run();

    if ((result.meta.changes ?? 0) === 1) {
      const acquired = await this.load(input.envelope.idempotencyKey);
      if (acquired === null) throw new Error("Async job state disappeared after claim");
      return { kind: "acquired", record: acquired };
    }

    const raced = await this.load(input.envelope.idempotencyKey);
    if (raced === null) throw new Error("Async job state disappeared during claim race");
    return this.classifyExisting(raced, input)
      ?? {
        kind: "leased",
        record: raced,
        retryAfterMs: positiveRetryAfter(retryAfterFromRecord(raced, input.now)),
      };
  }

  async reportProgress(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly progress: AsyncJobProgress;
  }): Promise<boolean> {
    const result = await this.options.db
      .prepare(`
        UPDATE async_job_runs
        SET progress_percent = ?, progress_code = ?, updated_at = ?
        WHERE environment = ?
          AND idempotency_key = ?
          AND state = 'running'
          AND lease_token = ?
          AND lease_expires_at > ?
      `)
      .bind(
        input.progress.percent,
        input.progress.code ?? null,
        input.now.toISOString(),
        this.options.environment,
        input.idempotencyKey,
        input.leaseToken,
        input.now.toISOString(),
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async complete(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<boolean> {
    const nowIso = input.now.toISOString();
    const result = await this.options.db
      .prepare(`
        UPDATE async_job_runs
        SET
          state = 'completed',
          progress_percent = 100,
          updated_at = ?,
          completed_at = ?,
          lease_token = NULL,
          lease_expires_at = NULL,
          next_attempt_at = NULL,
          failure_code = NULL
        WHERE environment = ?
          AND idempotency_key = ?
          AND state = 'running'
          AND lease_token = ?
          AND lease_expires_at > ?
      `)
      .bind(
        nowIso,
        nowIso,
        this.options.environment,
        input.idempotencyKey,
        input.leaseToken,
        nowIso,
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async retry(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly nextAttemptAt: Date;
    readonly failureCode: string;
  }): Promise<boolean> {
    if (input.nextAttemptAt.getTime() <= input.now.getTime()) {
      throw new RangeError("nextAttemptAt must be after now");
    }
    const nowIso = input.now.toISOString();
    const result = await this.options.db
      .prepare(`
        UPDATE async_job_runs
        SET
          state = 'retrying',
          updated_at = ?,
          lease_token = NULL,
          lease_expires_at = NULL,
          next_attempt_at = ?,
          failure_code = ?
        WHERE environment = ?
          AND idempotency_key = ?
          AND state = 'running'
          AND lease_token = ?
          AND lease_expires_at > ?
      `)
      .bind(
        nowIso,
        input.nextAttemptAt.toISOString(),
        input.failureCode,
        this.options.environment,
        input.idempotencyKey,
        input.leaseToken,
        nowIso,
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async fail(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly state: "failed" | "dead_letter";
    readonly failureCode: string;
  }): Promise<boolean> {
    const nowIso = input.now.toISOString();
    const result = await this.options.db
      .prepare(`
        UPDATE async_job_runs
        SET
          state = ?,
          updated_at = ?,
          completed_at = ?,
          lease_token = NULL,
          lease_expires_at = NULL,
          next_attempt_at = NULL,
          failure_code = ?
        WHERE environment = ?
          AND idempotency_key = ?
          AND state = 'running'
          AND lease_token = ?
          AND lease_expires_at > ?
      `)
      .bind(
        input.state,
        nowIso,
        nowIso,
        input.failureCode,
        this.options.environment,
        input.idempotencyKey,
        input.leaseToken,
        nowIso,
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  getByIdempotencyKey(idempotencyKey: string): Promise<AsyncJobRecord | null> {
    return this.load(idempotencyKey);
  }
}
