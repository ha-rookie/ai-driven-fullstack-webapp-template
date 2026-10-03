import assert from "node:assert/strict";
import test from "node:test";

import {
  AsyncJobExecutionError,
  CloudflareQueueAsyncJobPublisher,
  InMemoryAsyncJobStateStore,
  consumeCloudflareQueueMessage,
  createAsyncJobEnvelope,
  createScheduledJobIdentity,
  executeAsyncJob,
  type AsyncJobEnvelope,
  type AsyncJobExecutionResult,
} from "../src/shared/async-job";
import type { Clock, IdGenerator } from "../src/shared/runtime";

class MutableClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

const sequenceIdGenerator = (prefix = "id"): IdGenerator => {
  let sequence = 0;
  return {
    generate: () => `${prefix}-${++sequence}`,
  };
};

const retryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10_000,
  multiplier: 2,
} as const;

const createEnvelope = async (
  payload: Record<string, unknown> = { resourceId: "r-1" },
  overrides: Partial<{
    jobId: string;
    idempotencyKey: string;
    type: string;
    clock: Clock;
  }> = {},
) => createAsyncJobEnvelope({
  type: overrides.type ?? "resource.rebuild",
  payload,
  jobId: overrides.jobId ?? "job-1",
  idempotencyKey: overrides.idempotencyKey ?? "command-1",
  clock: overrides.clock,
});

test("job envelope rejects sensitive or non-JSON payload fields", async () => {
  await assert.rejects(
    () => createAsyncJobEnvelope({
      type: "resource.rebuild",
      payload: { userId: "u-1", password: "do-not-queue" },
      jobId: "job-1",
    }),
    /sensitive field 'password'/,
  );

  await assert.rejects(
    () => createAsyncJobEnvelope({
      type: "resource.rebuild",
      payload: { when: new Date("2026-10-03T00:00:00.000Z") },
      jobId: "job-1",
    }),
    /plain JSON objects/,
  );
});

test("payload fingerprint is stable across object key order", async () => {
  const left = await createEnvelope({ alpha: 1, beta: { x: true, y: "ok" } });
  const right = await createEnvelope({ beta: { y: "ok", x: true }, alpha: 1 }, {
    jobId: "job-2",
    idempotencyKey: "command-2",
  });

  assert.equal(left.payloadFingerprint, right.payloadFingerprint);
});

test("scheduled identity is deterministic for one schedule occurrence", () => {
  const scheduledFor = new Date("2026-10-03T12:00:00.000Z");
  const first = createScheduledJobIdentity("daily-report", scheduledFor);
  const second = createScheduledJobIdentity("daily-report", scheduledFor);

  assert.deepEqual(first, second);
  assert.equal(first.jobId, "scheduled:daily-report:2026-10-03T12:00:00.000Z");
  assert.equal(first.idempotencyKey, first.jobId);
});

test("duplicate delivery executes a completed job only once", async () => {
  const clock = new MutableClock(new Date("2026-10-03T00:00:00.000Z"));
  const store = new InMemoryAsyncJobStateStore();
  const envelope = await createEnvelope({}, { clock });
  const leaseIds = sequenceIdGenerator("lease");
  let calls = 0;

  const execute = () => executeAsyncJob({
    envelope,
    store,
    retryPolicy,
    leaseMs: 30_000,
    clock,
    idGenerator: leaseIds,
    handler: async () => { calls += 1; },
  });

  assert.deepEqual(await execute(), { kind: "completed", attempt: 1 });
  assert.deepEqual(await execute(), { kind: "duplicate_completed" });
  assert.equal(calls, 1);

  const record = await store.getByIdempotencyKey(envelope.idempotencyKey);
  assert.equal(record?.state, "completed");
  assert.equal(record?.attempt, 1);
});

test("active lease prevents a second worker from executing the same job", async () => {
  const clock = new MutableClock(new Date("2026-10-03T00:00:00.000Z"));
  const store = new InMemoryAsyncJobStateStore();
  const envelope = await createEnvelope({}, { clock });

  const firstClaim = await store.claim({
    envelope,
    leaseToken: "lease-owner-1",
    now: clock.now(),
    leaseMs: 30_000,
  });
  assert.equal(firstClaim.kind, "acquired");

  let called = false;
  const result = await executeAsyncJob({
    envelope,
    store,
    retryPolicy,
    leaseMs: 30_000,
    clock,
    idGenerator: sequenceIdGenerator("other-lease"),
    handler: async () => { called = true; },
  });

  assert.equal(result.kind, "busy");
  assert.equal(called, false);
});

test("retry waits until due and then succeeds on the next attempt", async () => {
  const clock = new MutableClock(new Date("2026-10-03T00:00:00.000Z"));
  const store = new InMemoryAsyncJobStateStore();
  const envelope = await createEnvelope({}, { clock });
  const leaseIds = sequenceIdGenerator("lease");
  let calls = 0;

  const execute = () => executeAsyncJob({
    envelope,
    store,
    retryPolicy,
    leaseMs: 30_000,
    clock,
    idGenerator: leaseIds,
    handler: async () => {
      calls += 1;
      if (calls === 1) {
        throw new AsyncJobExecutionError({
          retryable: true,
          code: "dependency_unavailable",
        });
      }
    },
  });

  assert.deepEqual(await execute(), {
    kind: "retry",
    attempt: 1,
    delayMs: 1000,
    failureCode: "dependency_unavailable",
  });

  const early = await execute();
  assert.equal(early.kind, "not_due");
  assert.equal(calls, 1);

  clock.advance(1000);
  assert.deepEqual(await execute(), { kind: "completed", attempt: 2 });
  assert.equal(calls, 2);
});

test("retry exhaustion moves the durable state to dead-letter equivalent", async () => {
  const clock = new MutableClock(new Date("2026-10-03T00:00:00.000Z"));
  const store = new InMemoryAsyncJobStateStore();
  const envelope = await createEnvelope({}, { clock });
  const policy = { ...retryPolicy, maxAttempts: 2 };
  const leaseIds = sequenceIdGenerator("lease");

  const execute = () => executeAsyncJob({
    envelope,
    store,
    retryPolicy: policy,
    leaseMs: 30_000,
    clock,
    idGenerator: leaseIds,
    handler: async () => {
      throw new AsyncJobExecutionError({ retryable: true, code: "temporary_failure" });
    },
  });

  const first = await execute();
  assert.equal(first.kind, "retry");
  clock.advance(first.kind === "retry" ? first.delayMs : 0);

  assert.deepEqual(await execute(), {
    kind: "dead_letter",
    attempt: 2,
    failureCode: "temporary_failure",
  });
  assert.deepEqual(await execute(), {
    kind: "terminal_duplicate",
    state: "dead_letter",
  });
});

test("non-retryable failure becomes terminal without another attempt", async () => {
  const clock = new MutableClock(new Date("2026-10-03T00:00:00.000Z"));
  const store = new InMemoryAsyncJobStateStore();
  const envelope = await createEnvelope({}, { clock });

  const result = await executeAsyncJob({
    envelope,
    store,
    retryPolicy,
    leaseMs: 30_000,
    clock,
    idGenerator: sequenceIdGenerator("lease"),
    handler: async () => {
      throw new AsyncJobExecutionError({ retryable: false, code: "invalid_command" });
    },
  });

  assert.deepEqual(result, {
    kind: "failed",
    attempt: 1,
    failureCode: "invalid_command",
  });
  assert.equal((await store.getByIdempotencyKey(envelope.idempotencyKey))?.state, "failed");
});

test("same idempotency key with different payload is rejected as a conflict", async () => {
  const clock = new MutableClock(new Date("2026-10-03T00:00:00.000Z"));
  const store = new InMemoryAsyncJobStateStore();
  const first = await createEnvelope({ value: "A" }, { clock });
  const second = await createEnvelope({ value: "B" }, {
    clock,
    jobId: "job-2",
    idempotencyKey: first.idempotencyKey,
  });

  await executeAsyncJob({
    envelope: first,
    store,
    retryPolicy,
    leaseMs: 30_000,
    clock,
    idGenerator: sequenceIdGenerator("lease-a"),
    handler: async () => undefined,
  });

  let secondCalled = false;
  const result = await executeAsyncJob({
    envelope: second,
    store,
    retryPolicy,
    leaseMs: 30_000,
    clock,
    idGenerator: sequenceIdGenerator("lease-b"),
    handler: async () => { secondCalled = true; },
  });

  assert.deepEqual(result, { kind: "conflict" });
  assert.equal(secondCalled, false);
});

test("handler can report bounded progress without storing job payload", async () => {
  const clock = new MutableClock(new Date("2026-10-03T00:00:00.000Z"));
  const store = new InMemoryAsyncJobStateStore();
  const envelope = await createEnvelope({ privateBusinessValue: "not-state-metadata" }, { clock });

  await executeAsyncJob({
    envelope,
    store,
    retryPolicy,
    leaseMs: 30_000,
    clock,
    idGenerator: sequenceIdGenerator("lease"),
    handler: async (_payload, context) => {
      await context.reportProgress({ percent: 35, code: "validated" });
    },
  });

  const record = await store.getByIdempotencyKey(envelope.idempotencyKey);
  assert.deepEqual(record?.progress, { percent: 100, code: "validated" });
  assert.equal(JSON.stringify(record).includes("privateBusinessValue"), false);
});

test("tampered queued payload is rejected before the handler executes", async () => {
  const envelope = await createEnvelope({ value: "original" });
  const tampered: AsyncJobEnvelope<{ value: string }> = {
    ...envelope,
    payload: { value: "changed" },
  };
  let called = false;

  await assert.rejects(
    () => executeAsyncJob({
      envelope: tampered,
      store: new InMemoryAsyncJobStateStore(),
      retryPolicy,
      leaseMs: 30_000,
      handler: async () => { called = true; },
    }),
    /fingerprint mismatch/,
  );
  assert.equal(called, false);
});

test("Cloudflare Queue publisher converts millisecond delay to bounded seconds", async () => {
  const sent: Array<{ envelope: AsyncJobEnvelope; delaySeconds?: number }> = [];
  const publisher = new CloudflareQueueAsyncJobPublisher(
    {
      send: async (envelope, options) => {
        sent.push({ envelope, delaySeconds: options?.delaySeconds });
      },
    },
    { maxDelaySeconds: 60 },
  );
  const envelope = await createEnvelope();

  await publisher.publish(envelope, { delayMs: 1250 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.delaySeconds, 2);
});

test("Cloudflare Queue consumer retries transient outcomes and acknowledges terminal ones", async () => {
  const envelope = await createEnvelope();
  const actions: string[] = [];
  const message = {
    body: envelope,
    ack: () => { actions.push("ack"); },
    retry: (options?: { delaySeconds?: number }) => {
      actions.push(`retry:${options?.delaySeconds ?? 0}`);
    },
  };

  const retryResult: AsyncJobExecutionResult = {
    kind: "retry",
    attempt: 1,
    delayMs: 1500,
    failureCode: "temporary_failure",
  };
  await consumeCloudflareQueueMessage(message, async () => retryResult);
  assert.deepEqual(actions, ["retry:2"]);

  actions.length = 0;
  const terminalResult: AsyncJobExecutionResult = {
    kind: "dead_letter",
    attempt: 3,
    failureCode: "temporary_failure",
  };
  await consumeCloudflareQueueMessage(message, async () => terminalResult);
  assert.deepEqual(actions, ["ack"]);
});
