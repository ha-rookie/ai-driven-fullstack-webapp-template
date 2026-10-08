import {
  verifyAsyncJobEnvelope,
  type AsyncJobEnvelope,
  type AsyncJobPublisher,
  type AsyncJobState,
} from "../../shared/async-job";
import { systemClock, type Clock, type RuntimeEnvironment } from "../../shared/runtime";
import type { OperationHandler, OperationHandlerResult } from "../operations";
import type { OperationDefinition, OperationRequest } from "../operations";

export interface RecoverableJobRecord {
  readonly jobId: string;
  readonly type: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly state: AsyncJobState;
  readonly attempt: number;
  readonly updatedAt: string;
  readonly failureCode?: string;
}

export interface JobRecoveryAdapter {
  readonly jobType: string;
  recover(input: {
    readonly environment: RuntimeEnvironment;
    readonly job: RecoverableJobRecord;
    readonly reason: string;
  }): Promise<OperationHandlerResult>;
}

export class JobRecoveryRegistry {
  private readonly adapters = new Map<string, JobRecoveryAdapter>();

  constructor(adapters: readonly JobRecoveryAdapter[] = []) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.jobType)) {
        throw new Error(`Duplicate job recovery adapter: ${adapter.jobType}`);
      }
      this.adapters.set(adapter.jobType, adapter);
    }
  }

  get(jobType: string): JobRecoveryAdapter | null {
    return this.adapters.get(jobType) ?? null;
  }
}


export const createD1RequeueJobRecoveryAdapter = (input: {
  readonly jobType: string;
  readonly db: D1Database;
  readonly publisher: AsyncJobPublisher;
  readonly rebuildEnvelope: (job: RecoverableJobRecord) => Promise<AsyncJobEnvelope>;
  readonly clock?: Clock;
}): JobRecoveryAdapter => ({
  jobType: input.jobType,
  async recover({ environment, job }): Promise<OperationHandlerResult> {
    if (job.type !== input.jobType || (job.state !== "failed" && job.state !== "dead_letter")) {
      return { result: "CONFLICT" };
    }

    let envelope: AsyncJobEnvelope;
    try {
      envelope = await input.rebuildEnvelope(job);
      await verifyAsyncJobEnvelope(envelope);
    } catch {
      return { result: "FAILED" };
    }

    if (
      envelope.jobId !== job.jobId
      || envelope.type !== job.type
      || envelope.idempotencyKey !== job.idempotencyKey
      || envelope.payloadFingerprint !== job.payloadFingerprint
    ) {
      return { result: "CONFLICT" };
    }

    const now = (input.clock ?? systemClock).now().toISOString();
    const reopened = await input.db.prepare(`
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

    try {
      await input.publisher.publish(envelope);
      return { result: "SUCCESS" };
    } catch {
      // The durable state is intentionally left as retrying. A reconciliation
      // operation can safely detect and republish it; claiming success here
      // would hide an unknown delivery outcome.
      return { result: "PARTIAL" };
    }
  },
});

export const JOB_RETRY_OPERATION: OperationDefinition = Object.freeze({
  id: "JOB_RETRY",
  capability: "jobs:retry",
  baseRisk: "CONTROLLED_CHANGE",
  reversible: false,
  idempotent: true,
  externalSideEffect: false,
  requiresVerification: true,
});

export const createJobRetryOperationHandler = (input: {
  readonly environment: RuntimeEnvironment;
  readonly job: RecoverableJobRecord;
  readonly adapter: JobRecoveryAdapter;
}): OperationHandler => ({
  definition: JOB_RETRY_OPERATION,
  async execute(request: OperationRequest): Promise<OperationHandlerResult> {
    if (
      request.target.resourceType !== "async_job"
      || request.target.resourceId !== input.job.jobId
      || request.environment !== input.environment
      || (input.job.state !== "failed" && input.job.state !== "dead_letter")
      || typeof request.reason !== "string"
      || request.reason.trim().length === 0
    ) {
      return { result: "CONFLICT" };
    }
    return input.adapter.recover({
      environment: input.environment,
      job: input.job,
      reason: request.reason.trim(),
    });
  },
  async verify(_request, execution) {
    return execution.result === "SUCCESS"
      ? { status: "PASSED", summary: "Recovery adapter accepted the retry command" }
      : { status: "UNKNOWN", summary: "Retry outcome requires reconciliation before another retry" };
  },
});
