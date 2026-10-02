export const IDEMPOTENCY_CLEANUP_DEFAULT_BATCH_SIZE = 25;
export const IDEMPOTENCY_CLEANUP_MAX_BATCH_SIZE = 100;

export interface IdempotencyCleanupInput {
  cutoff: string;
  batchSize?: number;
}

export interface IdempotencyCleanupResult {
  cutoff: string;
  batchSize: number;
  deletedCount: number;
  hasMore: boolean;
}

const normalizeCutoff = (value: string): string => {
  const normalized = value.trim();
  const timestamp = Date.parse(normalized);
  if (!normalized || !Number.isFinite(timestamp)) {
    throw new TypeError("cleanup cutoff must be a valid date-time");
  }
  return new Date(timestamp).toISOString();
};

const normalizeBatchSize = (value?: number): number => {
  const batchSize = value ?? IDEMPOTENCY_CLEANUP_DEFAULT_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > IDEMPOTENCY_CLEANUP_MAX_BATCH_SIZE
  ) {
    throw new TypeError(
      `cleanup batchSize must be an integer between 1 and ${IDEMPOTENCY_CLEANUP_MAX_BATCH_SIZE}`,
    );
  }
  return batchSize;
};

const changedRows = (result: D1Result<unknown>): number =>
  Number(result.meta?.changes ?? 0);

/**
 * Deletes one bounded batch of expired terminal idempotency records.
 *
 * `in_progress` rows are never eligible, even when their expiry timestamp is old.
 * `hasMore` is intentionally conservative: true means the batch was full and a
 * follow-up cleanup pass may be useful. No extra D1 read is performed solely to
 * count remaining records.
 */
export const cleanupExpiredIdempotencyRecords = async (
  db: D1Database,
  input: IdempotencyCleanupInput,
): Promise<IdempotencyCleanupResult> => {
  const cutoff = normalizeCutoff(input.cutoff);
  const batchSize = normalizeBatchSize(input.batchSize);

  const result = await db
    .prepare(
      `DELETE FROM idempotency_records
        WHERE rowid IN (
          SELECT rowid
            FROM idempotency_records
           WHERE expires_at <= ?
             AND state IN ('completed', 'failed')
           ORDER BY expires_at ASC, updated_at ASC, rowid ASC
           LIMIT ?
        )`,
    )
    .bind(cutoff, batchSize)
    .run();

  const deletedCount = changedRows(result);
  if (!Number.isInteger(deletedCount) || deletedCount < 0 || deletedCount > batchSize) {
    throw new Error("idempotency_cleanup_invalid_delete_count");
  }

  return {
    cutoff,
    batchSize,
    deletedCount,
    hasMore: deletedCount === batchSize,
  };
};
