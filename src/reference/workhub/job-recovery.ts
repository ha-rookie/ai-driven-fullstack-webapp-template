import {
  createAsyncJobEnvelope,
  D1AsyncJobStateStore,
  executeAsyncJob,
  type AsyncJobEnvelope,
} from "../../shared/async-job";
import { type RuntimeEnvironment } from "../../shared/runtime";
import {
  D1TravelRequestStore,
  WORKHUB_TRAVEL_RESOURCE_TYPE,
} from "./travel-request";
import { WorkhubTravelSearchProjector } from "./travel-search";
import {
  createSearchIndexProjectionJobHandler,
  D1SearchIndexStore,
} from "../../worker/search";
import {
  JobRecoveryRegistry,
  type JobRecoveryAdapter,
  type RecoverableJobRecord,
} from "../../worker/administration";

const SEARCH_JOB_TYPE = "search.index_projection";
const SEARCH_IDEMPOTENCY_PREFIX = "search-index:";

const parseSearchKey = (
  environment: RuntimeEnvironment,
  job: RecoverableJobRecord,
): { environment: RuntimeEnvironment; resourceType: string; resourceId: string } | null => {
  const prefix = `${SEARCH_IDEMPOTENCY_PREFIX}${environment}:${WORKHUB_TRAVEL_RESOURCE_TYPE}:`;
  if (!job.idempotencyKey.startsWith(prefix)) return null;
  const resourceId = job.idempotencyKey.slice(prefix.length);
  if (!resourceId) return null;
  return { environment, resourceType: WORKHUB_TRAVEL_RESOURCE_TYPE, resourceId };
};

export const createWorkhubSearchIndexRecoveryAdapter = (
  db: D1Database,
): JobRecoveryAdapter => ({
  jobType: SEARCH_JOB_TYPE,
  async recover({ environment, job }) {
    if (job.state !== "failed" && job.state !== "dead_letter") {
      return { result: "CONFLICT" };
    }
    const key = parseSearchKey(environment, job);
    if (!key) return { result: "CONFLICT" };

    const envelope: AsyncJobEnvelope = await createAsyncJobEnvelope({
      type: SEARCH_JOB_TYPE,
      payload: key,
      jobId: job.jobId,
      idempotencyKey: job.idempotencyKey,
    });
    if (envelope.payloadFingerprint !== job.payloadFingerprint) {
      return { result: "CONFLICT" };
    }

    const now = new Date().toISOString();
    const reopened = await db.prepare(`
      UPDATE async_job_runs
      SET
        state = 'retrying',
        updated_at = ?,
        completed_at = NULL,
        next_attempt_at = ?,
        lease_token = NULL,
        lease_expires_at = NULL
      WHERE environment = ?
        AND job_id = ?
        AND idempotency_key = ?
        AND payload_fingerprint = ?
        AND updated_at = ?
        AND state IN ('failed', 'dead_letter')
    `).bind(
      now,
      now,
      environment,
      job.jobId,
      job.idempotencyKey,
      job.payloadFingerprint,
      job.updatedAt,
    ).run();
    if ((reopened.meta.changes ?? 0) !== 1) {
      return { result: "CONFLICT" };
    }

    const travelStore = new D1TravelRequestStore(db);
    const writer = new D1SearchIndexStore(db);
    const projector = new WorkhubTravelSearchProjector(travelStore);
    const handler = createSearchIndexProjectionJobHandler({
      projector,
      writer,
    });

    const execution = await executeAsyncJob({
      envelope,
      store: new D1AsyncJobStateStore({ db, environment }),
      handler,
      retryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
      },
      leaseMs: 30_000,
    });

    switch (execution.kind) {
      case "completed":
      case "duplicate_completed":
        return { result: "SUCCESS" };
      case "retry":
      case "busy":
      case "not_due":
      case "lost_lease":
        return { result: "PARTIAL" };
      case "conflict":
      case "terminal_duplicate":
        return { result: "CONFLICT" };
      case "failed":
      case "dead_letter":
        return { result: "FAILED" };
    }
  },
});

export const createWorkhubJobRecoveryRegistry = (
  db: D1Database,
): JobRecoveryRegistry => new JobRecoveryRegistry([
  createWorkhubSearchIndexRecoveryAdapter(db),
]);
