import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryAsyncJobStateStore,
  executeAsyncJob,
} from "../src/shared/async-job";
import type { Clock, IdGenerator } from "../src/shared/runtime";
import {
  InMemoryIntegrationEventStore,
  IntegrationEventService,
  createIntegrationOutboxRelayJobEnvelope,
  createIntegrationOutboxRelayJobHandler,
  redriveDeadLetterOutbox,
  relayOutboxOnce,
  type IntegrationDeliveryAdapter,
} from "../src/worker/integration-event";

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return new Date(this.current.getTime()); }
  advance(milliseconds: number): void { this.current = new Date(this.current.getTime() + milliseconds); }
}

const sequenceIds = (prefix: string): IdGenerator => {
  let sequence = 0;
  return { generate: () => `${prefix}-${++sequence}` };
};

const NOW = "2026-10-04T10:00:00.000Z";
const input = {
  environment: "test",
  eventType: "travel.approved",
  schemaVersion: 1,
  destinationKey: "calendar",
  aggregateType: "travel_request",
  aggregateId: "travel-1",
  occurredAt: NOW,
  payload: { travelRequestId: "travel-1", requesterId: "aoi" },
} as const;

const fixture = () => {
  const clock = new MutableClock(new Date(NOW));
  const store = new InMemoryIntegrationEventStore();
  const service = new IntegrationEventService(store, clock, sequenceIds("integration"));
  return { clock, store, service };
};

test("enqueue persists versioned integration event and durable outbox separately", async () => {
  const { store, service } = fixture();
  const created = await service.enqueue(input);
  assert.equal(created.kind, "created");
  assert.equal(created.event.eventType, "travel.approved");
  assert.equal(created.event.schemaVersion, 1);
  assert.equal(created.outbox.status, "pending");
  assert.deepEqual(await store.getEvent(created.event.id, "test"), created.event);
  assert.deepEqual(await store.getOutbox(created.outbox.id, "test"), created.outbox);
});

test("same deterministic event and destination is duplicate-suppressed while environments stay isolated", async () => {
  const { store } = fixture();
  const ids = sequenceIds("unused");
  const testService = new IntegrationEventService(store, new MutableClock(new Date(NOW)), ids);
  const first = await testService.enqueue({ ...input, eventId: "transition-1", outboxId: "transition-1" });
  const duplicate = await testService.enqueue({ ...input, eventId: "transition-1", outboxId: "transition-1" });
  const preview = await testService.enqueue({ ...input, environment: "preview", eventId: "transition-1", outboxId: "transition-1" });
  assert.equal(first.kind, "created");
  assert.equal(duplicate.kind, "duplicate");
  assert.equal(preview.kind, "created");
});

test("integration payload rejects credential-like fields and oversized data", async () => {
  const { service } = fixture();
  await assert.rejects(() => service.enqueue({ ...input, payload: { accessToken: "secret" } }), /sensitive field/);
  await assert.rejects(() => service.enqueue({ ...input, payload: { value: "x".repeat(70 * 1024) } }), /64 KiB/);
});

test("relay marks successful delivery terminal and duplicate delivery does not call adapter again", async () => {
  const { clock, store, service } = fixture();
  const created = await service.enqueue(input);
  let calls = 0;
  const adapter: IntegrationDeliveryAdapter = { async deliver() { calls += 1; return { kind: "delivered" }; } };

  assert.deepEqual(await relayOutboxOnce({ environment: "test", outboxId: created.outbox.id, store, adapter, clock }), { kind: "delivered" });
  assert.deepEqual(await relayOutboxOnce({ environment: "test", outboxId: created.outbox.id, store, adapter, clock }), { kind: "duplicate_terminal", status: "delivered" });
  assert.equal(calls, 1);
  assert.equal((await store.getOutbox(created.outbox.id, "test"))?.status, "delivered");
});

test("retryable failure becomes retry_wait and succeeds only after availableAt", async () => {
  const { clock, store, service } = fixture();
  const created = await service.enqueue(input);
  let calls = 0;
  const adapter: IntegrationDeliveryAdapter = {
    async deliver() {
      calls += 1;
      return calls === 1
        ? { kind: "retryable_failure", failureCode: "provider_unavailable", retryAfterMs: 5_000 }
        : { kind: "delivered" };
    },
  };

  const first = await relayOutboxOnce({ environment: "test", outboxId: created.outbox.id, store, adapter, clock });
  assert.deepEqual(first, { kind: "retryable_failure", failureCode: "provider_unavailable", retryAfterMs: 5_000 });
  const early = await relayOutboxOnce({ environment: "test", outboxId: created.outbox.id, store, adapter, clock });
  assert.equal(early.kind, "not_due");
  assert.equal(calls, 1);
  clock.advance(5_000);
  assert.deepEqual(await relayOutboxOnce({ environment: "test", outboxId: created.outbox.id, store, adapter, clock }), { kind: "delivered" });
  assert.equal(calls, 2);
});

test("permanent delivery failure moves outbox to dead_letter", async () => {
  const { clock, store, service } = fixture();
  const created = await service.enqueue(input);
  const adapter: IntegrationDeliveryAdapter = {
    async deliver() { return { kind: "permanent_failure", failureCode: "destination_disabled" }; },
  };
  assert.deepEqual(
    await relayOutboxOnce({ environment: "test", outboxId: created.outbox.id, store, adapter, clock }),
    { kind: "permanent_failure", failureCode: "destination_disabled" },
  );
  const record = await store.getOutbox(created.outbox.id, "test");
  assert.equal(record?.status, "dead_letter");
  assert.equal(record?.failureCode, "destination_disabled");
});

test("provider exception after possible acceptance quarantines as UNKNOWN and blocks blind re-drive", async () => {
  const { clock, store, service } = fixture();
  const created = await service.enqueue(input);
  let deliveries = 0;
  const adapter: IntegrationDeliveryAdapter = {
    async deliver() {
      deliveries += 1;
      // A provider may have committed its side effect before this exception.
      throw new Error("response connection interrupted");
    },
  };
  assert.deepEqual(
    await relayOutboxOnce({ environment: "test", outboxId: created.outbox.id, store, adapter, clock }),
    { kind: "unknown", failureCode: "delivery_outcome_unknown" },
  );
  const quarantined = await store.getOutbox(created.outbox.id, "test");
  assert.equal(quarantined?.status, "dead_letter");
  assert.equal(quarantined?.failureCode, "delivery_outcome_unknown");
  assert.equal(quarantined?.attemptCount, 1);
  assert.equal(quarantined?.version, 3);
  assert.equal(quarantined?.deadLetteredAt, NOW);
  clock.advance(60_000);
  assert.deepEqual(
    await relayOutboxOnce({ environment: "test", outboxId: created.outbox.id, store, adapter, clock }),
    { kind: "duplicate_terminal", status: "dead_letter" },
  );
  assert.equal(deliveries, 1, "no automatic second delivery after ambiguous result");
  let authorizerCalled = false;
  const redrive = await redriveDeadLetterOutbox({
    environment: "test", outboxId: created.outbox.id, actorId: "admin-1",
    reasonCode: "provider_fixed", store, clock,
    authorize: () => { authorizerCalled = true; return true; },
  });
  assert.deepEqual(redrive, { kind: "denied" });
  assert.equal(authorizerCalled, false, "an authorizer alone must not clear UNKNOWN");
  assert.deepEqual(await store.getOutbox(created.outbox.id, "test"), quarantined);
});

test("explicit UNKNOWN adapter result never goes to retry_wait", async () => {
  const { clock, store, service } = fixture();
  const created = await service.enqueue(input);
  const adapter: IntegrationDeliveryAdapter = {
    async deliver() { return { kind: "unknown", failureCode: "raw-provider-message" }; },
  };
  const result = await relayOutboxOnce({
    environment: "test", outboxId: created.outbox.id, store, adapter, clock,
  });
  assert.deepEqual(result, { kind: "unknown", failureCode: "delivery_outcome_unknown" });
  const row = await store.getOutbox(created.outbox.id, "test");
  assert.equal(row?.status, "dead_letter");
  assert.equal(row?.failureCode, "delivery_outcome_unknown", "raw provider code is not stored");
});

test("malformed provider adapter result is quarantined as UNKNOWN, not silently retried", async () => {
  // Runtime adapters (including JavaScript/third-party implementations) may
  // violate the TypeScript contract. A malformed response is not evidence of
  // non-delivery and must never enter retry_wait.
  const malformed: readonly unknown[] = [
    undefined,
    null,
    {},
    { kind: "timeout", failureCode: "raw-provider-response", retryAfterMs: 1 },
  ];
  for (const candidate of malformed) {
    const { clock, store, service } = fixture();
    const created = await service.enqueue(input);
    let deliveries = 0;
    const adapter: IntegrationDeliveryAdapter = {
      async deliver() {
        deliveries += 1;
        return candidate as Awaited<ReturnType<IntegrationDeliveryAdapter["deliver"]>>;
      },
    };
    const relay = () => relayOutboxOnce({
      environment: "test", outboxId: created.outbox.id, store, adapter, clock,
    });
    assert.deepEqual(await relay(), { kind: "unknown", failureCode: "delivery_outcome_unknown" });
    const quarantined = await store.getOutbox(created.outbox.id, "test");
    assert.equal(quarantined?.status, "dead_letter");
    assert.equal(quarantined?.failureCode, "delivery_outcome_unknown");
    clock.advance(60_000);
    assert.deepEqual(await relay(), { kind: "duplicate_terminal", status: "dead_letter" });
    assert.equal(deliveries, 1, "an invalid Provider outcome never schedules a second send");
    const result = await redriveDeadLetterOutbox({
      environment: "test", outboxId: created.outbox.id, actorId: "admin-1",
      reasonCode: "provider_fixed", store, clock, authorize: () => true,
    });
    assert.deepEqual(result, { kind: "denied" });
    assert.deepEqual(await store.getOutbox(created.outbox.id, "test"), quarantined);
  }
});

test("#51 async relay classifies ambiguous provider result as nonretryable; no delivery repeats", async () => {
  const { clock, store, service } = fixture();
  const created = await service.enqueue(input);
  const envelope = await createIntegrationOutboxRelayJobEnvelope({
    environment: "test", outboxId: created.outbox.id, clock, idGenerator: sequenceIds("job"),
  });
  let attempts = 0;
  const handler = createIntegrationOutboxRelayJobHandler({
    store, clock, adapter: {
      async deliver() { attempts += 1; throw new Error("simulated ambiguous timeout"); },
    },
  });
  const jobStore = new InMemoryAsyncJobStateStore();
  const retryPolicy = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 10_000, multiplier: 2 } as const;
  const ids = sequenceIds("lease");
  const run = () => executeAsyncJob({
    envelope, store: jobStore, retryPolicy, leaseMs: 30_000, clock,
    idGenerator: ids, handler,
  });
  assert.deepEqual(await run(),
    { kind: "failed", attempt: 1, failureCode: "delivery_outcome_unknown" });
  clock.advance(60_000);
  const again = await run();
  assert.notEqual(again.kind, "retry");
  assert.equal(attempts, 1);
  assert.equal((await store.getOutbox(created.outbox.id, "test"))?.status, "dead_letter");
});

test("async job owns retry execution while outbox remains the delivery source of truth", async () => {
  const { clock, store, service } = fixture();
  const created = await service.enqueue(input);
  let calls = 0;
  const adapter: IntegrationDeliveryAdapter = {
    async deliver() {
      calls += 1;
      return calls === 1
        ? { kind: "retryable_failure", failureCode: "temporary", retryAfterMs: 1_000 }
        : { kind: "delivered" };
    },
  };
  const envelope = await createIntegrationOutboxRelayJobEnvelope({
    environment: "test",
    outboxId: created.outbox.id,
    clock,
    idGenerator: sequenceIds("job"),
  });
  const jobStore = new InMemoryAsyncJobStateStore();
  const handler = createIntegrationOutboxRelayJobHandler({ store, adapter, clock });
  const retryPolicy = { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 10_000, multiplier: 2 } as const;
  const leases = sequenceIds("lease");
  const execute = () => executeAsyncJob({ envelope, store: jobStore, retryPolicy, leaseMs: 30_000, clock, idGenerator: leases, handler });

  const first = await execute();
  assert.deepEqual(first, { kind: "retry", attempt: 1, delayMs: 1_000, failureCode: "temporary" });
  assert.equal((await store.getOutbox(created.outbox.id, "test"))?.status, "retry_wait");
  clock.advance(1_000);
  assert.deepEqual(await execute(), { kind: "completed", attempt: 2 });
  assert.equal((await store.getOutbox(created.outbox.id, "test"))?.status, "delivered");
});
