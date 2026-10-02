import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupExpiredIdempotencyRecords,
  IDEMPOTENCY_CLEANUP_DEFAULT_BATCH_SIZE,
} from "../src/infrastructure/d1-idempotency-cleanup";
import { runIdempotencyCleanup } from "../src/worker/maintenance";
import type { Logger, LogContext } from "../src/shared/logging";

type State = "in_progress" | "completed" | "failed";

interface RecordRow {
  id: number;
  state: State;
  expiresAt: string;
  updatedAt: string;
}

const fakeDb = (seed: RecordRow[]) => {
  const rows = [...seed];
  const statements: Array<{ sql: string; values: unknown[] }> = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          statements.push({ sql, values });
          return {
            async run() {
              if (!/DELETE FROM idempotency_records/.test(sql)) {
                throw new Error("unexpected SQL");
              }
              const [cutoff, batchSize] = values as [string, number];
              const eligible = rows
                .filter(
                  (row) =>
                    row.expiresAt <= cutoff &&
                    (row.state === "completed" || row.state === "failed"),
                )
                .sort(
                  (left, right) =>
                    left.expiresAt.localeCompare(right.expiresAt) ||
                    left.updatedAt.localeCompare(right.updatedAt) ||
                    left.id - right.id,
                )
                .slice(0, batchSize);
              const ids = new Set(eligible.map((row) => row.id));
              for (let index = rows.length - 1; index >= 0; index -= 1) {
                if (ids.has(rows[index].id)) rows.splice(index, 1);
              }
              return { meta: { changes: eligible.length } } as D1Result<unknown>;
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, rows, statements };
};

class CaptureLogger implements Logger {
  entries: Array<{ level: string; message: string; context?: LogContext }> = [];
  debug(message: string, context?: LogContext): void {
    this.entries.push({ level: "debug", message, context });
  }
  info(message: string, context?: LogContext): void {
    this.entries.push({ level: "info", message, context });
  }
  warn(message: string, context?: LogContext): void {
    this.entries.push({ level: "warn", message, context });
  }
  error(message: string, context?: LogContext): void {
    this.entries.push({ level: "error", message, context });
  }
}

const cutoff = "2026-10-02T00:00:00.000Z";

test("cleanup deletes only expired terminal records and preserves in-progress rows", async () => {
  const { db, rows, statements } = fakeDb([
    { id: 1, state: "completed", expiresAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" },
    { id: 2, state: "failed", expiresAt: "2026-10-01T01:00:00.000Z", updatedAt: "2026-10-01T01:00:00.000Z" },
    { id: 3, state: "in_progress", expiresAt: "2026-09-30T00:00:00.000Z", updatedAt: "2026-09-30T00:00:00.000Z" },
    { id: 4, state: "completed", expiresAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" },
  ]);

  const result = await cleanupExpiredIdempotencyRecords(db, { cutoff });

  assert.equal(result.deletedCount, 2);
  assert.equal(result.batchSize, IDEMPOTENCY_CLEANUP_DEFAULT_BATCH_SIZE);
  assert.equal(result.hasMore, false);
  assert.deepEqual(rows.map((row) => row.id).sort(), [3, 4]);
  assert.match(statements[0].sql, /state IN \('completed', 'failed'\)/);
  assert.match(statements[0].sql, /LIMIT \?/);
});

test("cleanup is bounded and reports a conservative follow-up hint", async () => {
  const { db, rows } = fakeDb([
    { id: 1, state: "completed", expiresAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
    { id: 2, state: "completed", expiresAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z" },
    { id: 3, state: "failed", expiresAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z" },
  ]);

  const first = await cleanupExpiredIdempotencyRecords(db, { cutoff, batchSize: 2 });
  assert.equal(first.deletedCount, 2);
  assert.equal(first.hasMore, true);
  assert.equal(rows.length, 1);

  const second = await cleanupExpiredIdempotencyRecords(db, { cutoff, batchSize: 2 });
  assert.equal(second.deletedCount, 1);
  assert.equal(second.hasMore, false);

  const third = await cleanupExpiredIdempotencyRecords(db, { cutoff, batchSize: 2 });
  assert.equal(third.deletedCount, 0);
  assert.equal(third.hasMore, false);
});

test("invalid cutoff and batch size fail before D1 access", async () => {
  const { db, statements } = fakeDb([]);

  await assert.rejects(
    () => cleanupExpiredIdempotencyRecords(db, { cutoff: "not-a-date" }),
    TypeError,
  );
  await assert.rejects(
    () => cleanupExpiredIdempotencyRecords(db, { cutoff, batchSize: 101 }),
    TypeError,
  );
  assert.equal(statements.length, 0);
});

test("maintenance boundary logs only bounded cleanup summary", async () => {
  const { db } = fakeDb([
    { id: 1, state: "completed", expiresAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
  ]);
  const logger = new CaptureLogger();

  const result = await runIdempotencyCleanup(db, { cutoff, logger });

  assert.equal(result.deletedCount, 1);
  assert.equal(logger.entries.length, 1);
  assert.equal(logger.entries[0].message, "idempotency_cleanup_completed");
  assert.deepEqual(logger.entries[0].context, {
    cutoff,
    batchSize: IDEMPOTENCY_CLEANUP_DEFAULT_BATCH_SIZE,
    deletedCount: 1,
    hasMore: false,
  });
  const serialized = JSON.stringify(logger.entries[0]);
  assert.equal(serialized.includes("idempotency_key"), false);
  assert.equal(serialized.includes("fingerprint"), false);
  assert.equal(serialized.includes("actor"), false);
  assert.equal(serialized.includes("scope"), false);
});
