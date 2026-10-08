import type { AsyncJobState } from "../../shared/async-job";
import type { RuntimeEnvironment } from "../../shared/runtime";
import type { OperationHandler, OperationHandlerResult } from "../operations";
import type { OperationDefinition, OperationRequest } from "../operations";

export interface RecoverableJobRecord {
  readonly jobId: string;
  readonly type: string;
  readonly idempotencyKey: string;
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
