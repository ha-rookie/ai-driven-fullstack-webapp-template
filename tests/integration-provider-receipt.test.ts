import assert from "node:assert/strict";
import test from "node:test";

import { createFixedClock } from "../src/shared/runtime";
import {
  InMemoryIntegrationEventStore,
  IntegrationEventService,
  assessOutboxProviderReceipt,
  redriveDeadLetterOutbox,
  relayOutboxOnce,
  type ProviderReceiptLookup,
} from "../src/worker/integration-event";

const NOW = "2026-10-16T10:00:00.000Z";
const clock = createFixedClock(NOW);

const fixture = async (deliveryKind: "unknown" | "delivered" = "unknown") => {
  const store = new InMemoryIntegrationEventStore();
  const service = new IntegrationEventService(store, clock, { generate: () => "event-419" });
  const created = await service.enqueue({
    environment: "test", eventType: "travel.approved", schemaVersion: 1,
    destinationKey: "calendar", eventId: "event-419", outboxId: "outbox-419",
    occurredAt: NOW, payload: { resourceId: "travel-1" },
  });
  assert.equal(created.kind, "created");
  const delivery = await relayOutboxOnce({
    environment: "test", outboxId: created.outbox.id, store, clock,
    adapter: { async deliver() { return { kind: deliveryKind }; } },
  });
  assert.equal(delivery.kind, deliveryKind);
  const row = await store.getOutbox(created.outbox.id, "test");
  assert.ok(row);
  const evidence = {
    outcome: "not_delivered",
    proofBasis: "authoritative_terminal_non_delivery",
    environment: row.environment,
    outboxId: row.id,
    integrationEventId: row.integrationEventId,
    destinationKey: row.destinationKey,
    outboxVersion: row.version,
    checkedAt: NOW,
  };
  const assess = (verifier?: ProviderReceiptLookup, environment = "test", outboxId = "outbox-419") =>
    assessOutboxProviderReceipt({ environment, outboxId, store, verifier, clock });
  return { store, row, evidence, assess };
};

test("#419 no real Provider verifier registered: UNKNOWN remains quarantined, no retry", async () => {
  const f = await fixture();
  assert.deepEqual(await f.assess(), {
    kind: "unverified", reason: "provider_not_registered", manualRetryAllowed: false,
  });
  const value = await redriveDeadLetterOutbox({
    store: f.store, clock, environment: "test", outboxId: "outbox-419",
    actorId: "operator", reasonCode: "provider_review", authorize: () => true,
  });
  assert.deepEqual(value, { kind: "denied" });
  assert.deepEqual(await f.store.getOutbox("outbox-419", "test"), f.row);
});

test("#419 authoritative matching acceptance / non-delivery are observations only, not execution", async () => {
  for (const outcome of ["not_delivered", "delivered"] as const) {
    const f = await fixture();
    const proofBasis = outcome === "delivered"
      ? "authoritative_acceptance_receipt" : "authoritative_terminal_non_delivery";
    const before = await f.store.getOutbox("outbox-419", "test");
    let requests = 0;
    const result = await f.assess({
      async verify(request) {
        requests += 1;
        assert.deepEqual(request, {
          environment: f.row.environment, outboxId: f.row.id,
          integrationEventId: f.row.integrationEventId,
          destinationKey: f.row.destinationKey, outboxVersion: f.row.version,
        });
        assert.equal("payload" in request, false);
        return { ...f.evidence, outcome, proofBasis };
      },
    });
    assert.deepEqual(result, {
      kind: outcome === "delivered" ? "verified_delivery" : "verified_non_delivery",
      checkedAt: NOW, manualRetryAllowed: false,
    });
    assert.equal(requests, 1);
    assert.deepEqual(await f.store.getOutbox("outbox-419", "test"), before);
    assert.equal((await redriveDeadLetterOutbox({
      environment: "test", outboxId: "outbox-419", actorId: "operator",
      reasonCode: "provider_review", store: f.store, clock, authorize: () => true,
    })).kind, "denied", "verified observation does not bypass UNKNOWN redrive guard");
  }
});

test("#419 missing, foreign-environment, and non-UNKNOWN records never invoke verifier", async () => {
  const f = await fixture();
  let calls = 0;
  const verifier: ProviderReceiptLookup = {
    async verify() { calls += 1; return f.evidence; },
  };
  assert.deepEqual(await f.assess(verifier, "production"), {
    kind: "missing", manualRetryAllowed: false,
  });
  assert.deepEqual(await f.assess(verifier, "test", "other-outbox"), {
    kind: "missing", manualRetryAllowed: false,
  });
  const delivered = await fixture("delivered");
  assert.deepEqual(await delivered.assess(verifier), {
    kind: "not_applicable", manualRetryAllowed: false,
  });
  assert.equal(calls, 0);
});

test("#419 malformed / absent / ambiguous Provider observation always fails closed", async () => {
  const f = await fixture();
  const unsafe: readonly unknown[] = [
    null, undefined, "not_delivered", 0, ["delivered"], {},
    { ...f.evidence, outcome: "not_found" },
    { ...f.evidence, outcome: "unknown" },
    { ...f.evidence, proofBasis: "receipt_not_found" },
    { ...f.evidence, proofBasis: "authoritative_acceptance_receipt" },
    { ...f.evidence, outcome: "delivered" },
    { ...f.evidence, outboxId: "other-outbox" },
    { ...f.evidence, integrationEventId: "other-event" },
    { ...f.evidence, destinationKey: "other-destination" },
    { ...f.evidence, environment: "production" },
    { ...f.evidence, outboxVersion: f.row.version + 1 },
    { ...f.evidence, outboxVersion: String(f.row.version) },
    { ...f.evidence, checkedAt: "2026-10-16T10:00:01.000Z" },
    { ...f.evidence, checkedAt: "2026-10-16T09:54:59.000Z" },
    { ...f.evidence, checkedAt: "not-a-date" },
    { ...f.evidence, checkedAt: 0 },
    { ...f.evidence, rawProviderResponse: "Bearer secret-provider-token" },
  ];
  for (const item of unsafe) {
    const result = await f.assess({ async verify() { return item; } });
    assert.deepEqual(result, {
      kind: "unverified", reason: "provider_evidence_unavailable", manualRetryAllowed: false,
    });
    assert.doesNotMatch(JSON.stringify(result), /Bearer|secret-provider-token|rawProviderResponse/u);
  }
  assert.deepEqual(await f.store.getOutbox("outbox-419", "test"), f.row);
});

test("#419 Provider exception and concurrent outbox version change fail closed", async () => {
  const f = await fixture();
  const thrown = await f.assess({
    async verify() { throw new Error("Bearer secret-provider-token"); },
  });
  assert.deepEqual(thrown, {
    kind: "unverified", reason: "provider_evidence_unavailable", manualRetryAllowed: false,
  });
  assert.doesNotMatch(JSON.stringify(thrown), /Bearer|secret-provider-token/u);

  const changed = await fixture();
  let called = 0;
  const result = await changed.assess({
    async verify() {
      called += 1;
      const old = await changed.store.getOutbox("outbox-419", "test");
      assert.ok(old);
      const updated = await changed.store.compareAndSetOutbox({
        record: { ...old, version: old.version + 1, updatedAt: "2026-10-16T10:00:00.000Z" },
        expectedVersion: old.version, expectedStatus: old.status,
      });
      assert.equal(updated, true);
      return changed.evidence;
    },
  });
  assert.equal(called, 1);
  assert.deepEqual(result, { kind: "stale_outbox", manualRetryAllowed: false });
});

test("#419 invalid local identifiers reject before Provider lookup", async () => {
  const f = await fixture();
  await assert.rejects(() => f.assess(undefined, "test", "../path"), /bounded local identifiers/u);
  await assert.rejects(() => f.assess(undefined, "production?x=1"), /bounded local identifiers/u);
});


test("#419 missing source event is unverified without a Provider lookup", async () => {
  const f = await fixture();
  const before = await f.store.getOutbox("outbox-419", "test");
  // Simulate an inconsistent read: the Outbox exists but its source Event is absent.
  Object.defineProperty(f.store, "getEvent", { value: async () => null });
  let calls = 0;
  const result = await f.assess({
    async verify() { calls += 1; return f.evidence; },
  });
  assert.deepEqual(result, {
    kind: "unverified", reason: "provider_evidence_unavailable", manualRetryAllowed: false,
  });
  assert.equal(calls, 0);
  assert.deepEqual(await f.store.getOutbox("outbox-419", "test"), before);
});

test("#419 throwing accessors and proxies cannot crash or leak a receipt assessment", async () => {
  const f = await fixture();
  const toxic = { ...f.evidence };
  Object.defineProperty(toxic, "checkedAt", {
    enumerable: true,
    get() { throw new Error("Bearer secret-provider-token"); },
  });
  const dangerous = [
    toxic,
    new Proxy({ ...f.evidence }, {
      ownKeys() { throw new Error("Bearer secret-provider-token"); },
    }),
    new Proxy({ ...f.evidence }, {
      getPrototypeOf() { throw new Error("Bearer secret-provider-token"); },
    }),
  ];
  for (const evidence of dangerous) {
    const result = await f.assess({ async verify() { return evidence; } });
    assert.deepEqual(result, {
      kind: "unverified", reason: "provider_evidence_unavailable", manualRetryAllowed: false,
    });
    assert.doesNotMatch(JSON.stringify(result), /Bearer|secret-provider-token/u);
  }
  assert.deepEqual(await f.store.getOutbox("outbox-419", "test"), f.row);
});

test("#419 adapter accessor changes cannot flip a validated receipt outcome", async () => {
  const f = await fixture();
  const observation = { ...f.evidence };
  let reads = 0;
  Object.defineProperty(observation, "outcome", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? "not_delivered" : "delivered";
    },
  });
  const result = await f.assess({ async verify() { return observation; } });
  assert.deepEqual(result, {
    kind: "verified_non_delivery", checkedAt: NOW, manualRetryAllowed: false,
  });
  assert.equal(reads, 1, "the validated outcome must be read from the adapter only once");
  assert.deepEqual(await f.store.getOutbox("outbox-419", "test"), f.row);
});
