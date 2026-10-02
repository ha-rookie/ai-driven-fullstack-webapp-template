import {
  cleanupExpiredIdempotencyRecords,
  type IdempotencyCleanupInput,
  type IdempotencyCleanupResult,
} from "../../infrastructure/d1-idempotency-cleanup";
import { NoopLogger, type Logger } from "../../shared/logging";

export interface IdempotencyCleanupRunnerInput extends IdempotencyCleanupInput {
  logger?: Logger;
}

/**
 * One-shot maintenance boundary. Scheduling remains a Product concern.
 */
export const runIdempotencyCleanup = async (
  db: D1Database,
  input: IdempotencyCleanupRunnerInput,
): Promise<IdempotencyCleanupResult> => {
  const logger = input.logger ?? new NoopLogger();

  try {
    const result = await cleanupExpiredIdempotencyRecords(db, input);
    logger.info("idempotency_cleanup_completed", {
      cutoff: result.cutoff,
      batchSize: result.batchSize,
      deletedCount: result.deletedCount,
      hasMore: result.hasMore,
    });
    return result;
  } catch (error) {
    logger.error("idempotency_cleanup_failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }
};
