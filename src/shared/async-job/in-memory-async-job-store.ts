import {
  normalizeAsyncJobProgress,
  retryAfterFromRecord,
  type AsyncJobClaimInput,
  type AsyncJobClaimResult,
  type AsyncJobProgress,
  type AsyncJobRecord,
  type AsyncJobStateStore,
} from "./async-job";

const cloneRecord = (record: AsyncJobRecord): AsyncJobRecord => ({
  ...record,
  ...(record.progress === undefined ? {} : { progress: { ...record.progress } }),
});

const isLeaseCurrent = (
  record: AsyncJobRecord,
  leaseToken: string,
  now: Date,
): boolean =>
  record.state === "running"
  && record.leaseToken === leaseToken
  && record.leaseExpiresAt !== undefined
  && new Date(record.leaseExpiresAt).getTime() > now.getTime();

export class InMemoryAsyncJobStateStore implements AsyncJobStateStore {
  private readonly records = new Map<string, AsyncJobRecord>();

  async claim(input: AsyncJobClaimInput): Promise<AsyncJobClaimResult> {
    const { envelope, now } = input;
    let record = this.records.get(envelope.idempotencyKey);

    if (record === undefined) {
      record = {
        jobId: envelope.jobId,
        type: envelope.type,
        idempotencyKey: envelope.idempotencyKey,
        payloadFingerprint: envelope.payloadFingerprint,
        state: "pending",
        attempt: 0,
        requestedAt: envelope.requestedAt,
        updatedAt: now.toISOString(),
      };
      this.records.set(envelope.idempotencyKey, record);
    }

    if (
      record.type !== envelope.type
      || record.payloadFingerprint !== envelope.payloadFingerprint
    ) {
      return { kind: "conflict", record: cloneRecord(record) };
    }

    if (record.state === "completed") {
      return { kind: "completed", record: cloneRecord(record) };
    }
    if (record.state === "failed" || record.state === "dead_letter") {
      return { kind: "terminal", record: cloneRecord(record) };
    }

    if (
      record.state === "running"
      && record.leaseExpiresAt !== undefined
      && new Date(record.leaseExpiresAt).getTime() > now.getTime()
    ) {
      return {
        kind: "leased",
        record: cloneRecord(record),
        retryAfterMs: retryAfterFromRecord(record, now),
      };
    }

    if (
      record.state === "retrying"
      && record.nextAttemptAt !== undefined
      && new Date(record.nextAttemptAt).getTime() > now.getTime()
    ) {
      return {
        kind: "not_due",
        record: cloneRecord(record),
        retryAfterMs: retryAfterFromRecord(record, now),
      };
    }

    const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
    const acquired: AsyncJobRecord = {
      ...record,
      state: "running",
      attempt: record.attempt + 1,
      startedAt: record.startedAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      leaseToken: input.leaseToken,
      leaseExpiresAt,
      nextAttemptAt: undefined,
      failureCode: undefined,
    };
    this.records.set(envelope.idempotencyKey, acquired);
    return { kind: "acquired", record: cloneRecord(acquired) };
  }

  async reportProgress(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly progress: AsyncJobProgress;
  }): Promise<boolean> {
    const record = this.records.get(input.idempotencyKey);
    if (record === undefined || !isLeaseCurrent(record, input.leaseToken, input.now)) return false;

    const progress = normalizeAsyncJobProgress(input.progress);
    this.records.set(input.idempotencyKey, {
      ...record,
      progress,
      updatedAt: input.now.toISOString(),
    });
    return true;
  }

  async complete(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<boolean> {
    const record = this.records.get(input.idempotencyKey);
    if (record === undefined || !isLeaseCurrent(record, input.leaseToken, input.now)) return false;

    this.records.set(input.idempotencyKey, {
      ...record,
      state: "completed",
      progress: { percent: 100, code: record.progress?.code },
      updatedAt: input.now.toISOString(),
      completedAt: input.now.toISOString(),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      failureCode: undefined,
    });
    return true;
  }

  async retry(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly nextAttemptAt: Date;
    readonly failureCode: string;
  }): Promise<boolean> {
    const record = this.records.get(input.idempotencyKey);
    if (record === undefined || !isLeaseCurrent(record, input.leaseToken, input.now)) return false;
    if (input.nextAttemptAt.getTime() <= input.now.getTime()) {
      throw new RangeError("nextAttemptAt must be after now");
    }

    this.records.set(input.idempotencyKey, {
      ...record,
      state: "retrying",
      updatedAt: input.now.toISOString(),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: input.nextAttemptAt.toISOString(),
      failureCode: input.failureCode,
    });
    return true;
  }

  async fail(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly state: "failed" | "dead_letter";
    readonly failureCode: string;
  }): Promise<boolean> {
    const record = this.records.get(input.idempotencyKey);
    if (record === undefined || !isLeaseCurrent(record, input.leaseToken, input.now)) return false;

    this.records.set(input.idempotencyKey, {
      ...record,
      state: input.state,
      updatedAt: input.now.toISOString(),
      completedAt: input.now.toISOString(),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      failureCode: input.failureCode,
    });
    return true;
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<AsyncJobRecord | null> {
    const record = this.records.get(idempotencyKey);
    return record === undefined ? null : cloneRecord(record);
  }
}
