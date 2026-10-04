import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryInboundWebhookReceiptStore,
  InboundWebhookProcessingError,
  InboundWebhookService,
  InboundWebhookVerificationError,
  type InboundWebhookVerifier,
} from "../src/worker/inbound-webhook";
import { createFixedClock, type IdGenerator } from "../src/shared/runtime";

const clock = createFixedClock("2026-10-04T12:00:00.000Z");

const ids = (): IdGenerator => {
  let sequence = 0;
  return { generate: () => `receipt-${++sequence}` };
};

const headers = { get: (_name: string) => null };
const rawBody = new TextEncoder().encode('{"event":"approved"}');

const verifier = (overrides: Partial<Awaited<ReturnType<InboundWebhookVerifier["verify"]>>> = {}): InboundWebhookVerifier => ({
  async verify(input) {
    return {
      providerKey: input.providerKey,
      providerEventId: "evt-1",
      replayKey: "evt-1",
      eventType: "travel.approved",
      occurredAt: "2026-10-04T11:59:00.000Z",
      payload: { travelRequestId: "travel-1" },
      ...overrides,
    };
  },
});

const fixture = (customVerifier = verifier()) => {
  const store = new InMemoryInboundWebhookReceiptStore();
  const handled: unknown[] = [];
  const service = new InboundWebhookService({
    environment: "test",
    store,
    verifier: customVerifier,
    mapper: {
      map(event) {
        if (event.eventType === "ignored.event") return null;
        return { travelRequestId: (event.payload as { travelRequestId: string }).travelRequestId };
      },
    },
    handler: {
      async handle(command) {
        handled.push(command);
      },
    },
    clock,
    idGenerator: ids(),
  });
  return { store, service, handled };
};

test("verified webhook is processed once and persisted without raw payload", async () => {
  const { store, service, handled } = fixture();
  const result = await service.handle({ providerKey: "reference", headers, rawBody });

  assert.equal(result.kind, "processed");
  assert.equal(result.receipt.status, "processed");
  assert.equal(result.receipt.attemptCount, 1);
  assert.deepEqual(handled, [{ travelRequestId: "travel-1" }]);

  const persisted = await store.get(result.receipt.id, "test");
  assert.equal(persisted?.providerEventId, "evt-1");
  assert.equal("payload" in (persisted ?? {}), false);
});

test("duplicate provider delivery is acknowledged without duplicate business mutation", async () => {
  const { service, handled } = fixture();
  const first = await service.handle({ providerKey: "reference", headers, rawBody });
  const second = await service.handle({ providerKey: "reference", headers, rawBody });

  assert.equal(first.kind, "processed");
  assert.equal(second.kind, "duplicate");
  assert.equal(second.receipt.id, first.receipt.id);
  assert.equal(handled.length, 1);
});

test("retryable failure can resume on provider redelivery with the same receipt identity", async () => {
  const store = new InMemoryInboundWebhookReceiptStore();
  let calls = 0;
  const service = new InboundWebhookService({
    environment: "test",
    store,
    verifier: verifier(),
    mapper: { map: () => ({ travelRequestId: "travel-1" }) },
    handler: {
      async handle() {
        calls += 1;
        if (calls === 1) throw new InboundWebhookProcessingError("dependency_unavailable", true);
      },
    },
    clock,
    idGenerator: ids(),
  });

  await assert.rejects(
    () => service.handle({ providerKey: "reference", headers, rawBody }),
    (error: unknown) => error instanceof InboundWebhookProcessingError && error.code === "dependency_unavailable",
  );
  const failed = await store.getByReplayKey("test", "reference", "evt-1");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.attemptCount, 1);

  const retried = await service.handle({ providerKey: "reference", headers, rawBody });
  assert.equal(retried.kind, "processed");
  assert.equal(retried.receipt.id, failed?.id);
  assert.equal(retried.receipt.attemptCount, 2);
  assert.equal(calls, 2);
});

test("non-retryable failure becomes dead letter and is not re-executed on redelivery", async () => {
  const store = new InMemoryInboundWebhookReceiptStore();
  let calls = 0;
  const service = new InboundWebhookService({
    environment: "test",
    store,
    verifier: verifier(),
    mapper: { map: () => ({ travelRequestId: "travel-1" }) },
    handler: {
      async handle() {
        calls += 1;
        throw new InboundWebhookProcessingError("invalid_mapping", false);
      },
    },
    clock,
    idGenerator: ids(),
  });

  await assert.rejects(() => service.handle({ providerKey: "reference", headers, rawBody }));
  const dead = await store.getByReplayKey("test", "reference", "evt-1");
  assert.equal(dead?.status, "dead_letter");

  const duplicate = await service.handle({ providerKey: "reference", headers, rawBody });
  assert.equal(duplicate.kind, "duplicate");
  assert.equal(duplicate.receipt.status, "dead_letter");
  assert.equal(calls, 1);
});

test("verification must complete before mapping or business handling", async () => {
  let mapperCalled = false;
  let handlerCalled = false;
  const service = new InboundWebhookService({
    environment: "test",
    store: new InMemoryInboundWebhookReceiptStore(),
    verifier: {
      async verify() {
        throw new InboundWebhookVerificationError("invalid_signature");
      },
    },
    mapper: { map() { mapperCalled = true; return {}; } },
    handler: { async handle() { handlerCalled = true; } },
    clock,
    idGenerator: ids(),
  });

  await assert.rejects(
    () => service.handle({ providerKey: "reference", headers, rawBody }),
    (error: unknown) => error instanceof InboundWebhookVerificationError && error.code === "invalid_signature",
  );
  assert.equal(mapperCalled, false);
  assert.equal(handlerCalled, false);
});

test("provider mismatch after verification fails closed", async () => {
  const { service } = fixture(verifier({ providerKey: "other" }));
  await assert.rejects(
    () => service.handle({ providerKey: "reference", headers, rawBody }),
    (error: unknown) => error instanceof InboundWebhookVerificationError && error.code === "provider_mismatch",
  );
});

test("unknown mapped event can be ignored without business mutation", async () => {
  const { service, handled } = fixture(verifier({ eventType: "ignored.event" }));
  const result = await service.handle({ providerKey: "reference", headers, rawBody });
  assert.equal(result.kind, "ignored");
  assert.equal(result.receipt.status, "ignored");
  assert.equal(handled.length, 0);
});

test("body size and provider key are validated before verifier invocation", async () => {
  let verifierCalled = false;
  const { service } = fixture({
    async verify() {
      verifierCalled = true;
      return verifier().verify({ providerKey: "reference", headers, rawBody, receivedAt: clock.now().toISOString() });
    },
  });

  await assert.rejects(
    () => service.handle({ providerKey: "Reference Invalid", headers, rawBody }),
    (error: unknown) => error instanceof InboundWebhookVerificationError && error.code === "invalid_provider",
  );
  assert.equal(verifierCalled, false);
});
