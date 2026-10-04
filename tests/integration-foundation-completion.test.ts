import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkhubTravelApprovedIntegrationSink,
  WorkhubTravelBookingConfirmationHandler,
  WorkhubTravelBookingConfirmationMapper,
  WORKHUB_TRAVEL_BOOKING_CONFIRMED_EVENT_TYPE,
} from "../src/reference/workhub/travel-request";
import { createFixedClock, type IdGenerator } from "../src/shared/runtime";
import {
  InMemoryInboundWebhookReceiptStore,
  InboundWebhookService,
  InboundWebhookVerificationError,
  resolveInboundWebhookVerificationKeys,
  type InboundWebhookVerifier,
} from "../src/worker/inbound-webhook";
import {
  InMemoryIntegrationEventStore,
  IntegrationEventService,
  redriveDeadLetterOutbox,
  relayOutboxOnce,
} from "../src/worker/integration-event";
import {
  securityRejectionAuditEvent,
  securityRejectionLogContext,
  type SecurityRejectionEvent,
} from "../src/worker/security";
import type { WorkflowInstanceRecord, WorkflowTransitionRecord } from "../src/worker/workflow";

const clock = createFixedClock("2026-10-04T13:00:00.000Z");
const headers = { get: () => null };
const rawBody = new TextEncoder().encode('{"event":"booking_confirmed"}');

const ids = (): IdGenerator => {
  let sequence = 0;
  return { generate: () => `id-${++sequence}` };
};

const verifiedBooking = (overrides: Partial<Awaited<ReturnType<InboundWebhookVerifier["verify"]>>> = {}): InboundWebhookVerifier => ({
  async verify(input) {
    return {
      providerKey: input.providerKey,
      providerEventId: "provider-event-1",
      replayKey: "provider-event-1",
      eventType: WORKHUB_TRAVEL_BOOKING_CONFIRMED_EVENT_TYPE,
      occurredAt: "2026-10-04T12:59:00.000Z",
      payload: {
        travelRequestId: "travel-1",
        bookingReference: "BOOK-001",
      },
      ...overrides,
    };
  },
});

const securityContext = {
  requestId: "request-1",
  method: "POST",
  path: "/webhooks/reference",
  timestamp: new Date("2026-10-04T13:00:00.000Z"),
};

test("invalid signature is emitted through #91 security rejection contract without sensitive payload", async () => {
  const securityEvents: SecurityRejectionEvent[] = [];
  const service = new InboundWebhookService({
    environment: "test",
    store: new InMemoryInboundWebhookReceiptStore(),
    verifier: {
      async verify() {
        throw new InboundWebhookVerificationError("invalid_signature");
      },
    },
    mapper: new WorkhubTravelBookingConfirmationMapper(),
    handler: { async handle() {} },
    securityRejectionSink: { record(event) { securityEvents.push(event); } },
    clock,
    idGenerator: ids(),
  });

  await assert.rejects(
    () => service.handle({ providerKey: "reference", headers, rawBody, securityContext }),
    (error: unknown) => error instanceof InboundWebhookVerificationError && error.code === "invalid_signature",
  );

  assert.equal(securityEvents.length, 1);
  assert.equal(securityEvents[0]?.eventType, "webhook_rejected");
  assert.equal(securityEvents[0]?.reasonCode, "webhook_signature_invalid");
  assert.equal(securityEvents[0]?.resourceType, "webhook_endpoint");
  const audit = securityRejectionAuditEvent(securityEvents[0]!);
  const log = securityRejectionLogContext(securityEvents[0]!);
  assert.equal(audit.reason, "webhook_signature_invalid");
  assert.equal(log.reasonCode, "webhook_signature_invalid");
  assert.equal(JSON.stringify({ audit, log }).includes("booking_confirmed"), false);
  assert.equal(JSON.stringify({ audit, log }).includes("signature-value"), false);
});

test("verifier-classified replay rejection emits security event but legitimate receipt duplicate does not", async () => {
  const rejected: SecurityRejectionEvent[] = [];
  const replayRejected = new InboundWebhookService({
    environment: "test",
    store: new InMemoryInboundWebhookReceiptStore(),
    verifier: { async verify() { throw new InboundWebhookVerificationError("replay_rejected"); } },
    mapper: new WorkhubTravelBookingConfirmationMapper(),
    handler: { async handle() {} },
    securityRejectionSink: { record(event) { rejected.push(event); } },
    clock,
    idGenerator: ids(),
  });
  await assert.rejects(() => replayRejected.handle({ providerKey: "reference", headers, rawBody, securityContext }));
  assert.equal(rejected[0]?.reasonCode, "webhook_replay_rejected");

  const legitimateEvents: SecurityRejectionEvent[] = [];
  const handled: unknown[] = [];
  const legitimate = new InboundWebhookService({
    environment: "test",
    store: new InMemoryInboundWebhookReceiptStore(),
    verifier: verifiedBooking(),
    mapper: new WorkhubTravelBookingConfirmationMapper(),
    handler: { async handle(command) { handled.push(command); } },
    securityRejectionSink: { record(event) { legitimateEvents.push(event); } },
    clock,
    idGenerator: ids(),
  });
  const first = await legitimate.handle({ providerKey: "reference", headers, rawBody, securityContext });
  const second = await legitimate.handle({ providerKey: "reference", headers, rawBody, securityContext });
  assert.equal(first.kind, "processed");
  assert.equal(second.kind, "duplicate");
  assert.equal(handled.length, 1);
  assert.equal(legitimateEvents.length, 0);
});

test("security sink failure never turns an invalid webhook into success", async () => {
  const service = new InboundWebhookService({
    environment: "test",
    store: new InMemoryInboundWebhookReceiptStore(),
    verifier: { async verify() { throw new InboundWebhookVerificationError("invalid_signature"); } },
    mapper: new WorkhubTravelBookingConfirmationMapper(),
    handler: { async handle() {} },
    securityRejectionSink: { async record() { throw new Error("audit unavailable"); } },
    clock,
    idGenerator: ids(),
  });
  await assert.rejects(
    () => service.handle({ providerKey: "reference", headers, rawBody, securityContext }),
    (error: unknown) => error instanceof InboundWebhookVerificationError && error.code === "invalid_signature",
  );
});

test("verification key rotation exposes bounded secret references, not raw key material", async () => {
  const candidates = await resolveInboundWebhookVerificationKeys({
    providerKey: "reference",
    receivedAt: "2026-10-04T13:00:00.000Z",
    keyHint: "key-current",
    resolver: {
      async resolveCandidates() {
        return [
          { keyId: "key-current", secretRef: "secrets/webhook/current" },
          { keyId: "key-previous", secretRef: "secrets/webhook/previous" },
        ];
      },
    },
  });
  assert.deepEqual(candidates.map(({ keyId }) => keyId), ["key-current", "key-previous"]);
  assert.equal(JSON.stringify(candidates).includes("raw-secret-value"), false);

  await assert.rejects(
    () => resolveInboundWebhookVerificationKeys({
      providerKey: "reference",
      receivedAt: "2026-10-04T13:00:00.000Z",
      resolver: { async resolveCandidates() { return []; } },
    }),
    (error: unknown) => error instanceof InboundWebhookVerificationError && error.code === "verification_key_unavailable",
  );
});

test("dead-letter re-drive requires authorization and preserves event/outbox identity", async () => {
  const store = new InMemoryIntegrationEventStore();
  const service = new IntegrationEventService(store, clock, ids());
  const created = await service.enqueue({
    environment: "test",
    eventType: "travel.approved",
    schemaVersion: 1,
    destinationKey: "reference",
    aggregateType: "travel_request",
    aggregateId: "travel-1",
    occurredAt: "2026-10-04T12:59:00.000Z",
    payload: { travelRequestId: "travel-1" },
  });
  await relayOutboxOnce({
    environment: "test",
    outboxId: created.outbox.id,
    store,
    adapter: { async deliver() { return { kind: "permanent_failure", failureCode: "provider_rejected" }; } },
    clock,
  });
  const dead = await store.getOutbox(created.outbox.id, "test");
  assert.equal(dead?.status, "dead_letter");

  const denied = await redriveDeadLetterOutbox({
    environment: "test",
    outboxId: created.outbox.id,
    actorId: "admin-1",
    reasonCode: "provider_fixed",
    store,
    authorize: () => false,
    clock,
  });
  assert.equal(denied.kind, "denied");
  assert.equal((await store.getOutbox(created.outbox.id, "test"))?.status, "dead_letter");

  const redriven = await redriveDeadLetterOutbox({
    environment: "test",
    outboxId: created.outbox.id,
    actorId: "admin-1",
    reasonCode: "provider_fixed",
    store,
    authorize: () => true,
    clock,
  });
  assert.equal(redriven.kind, "redriven");
  if (redriven.kind !== "redriven") return;
  assert.equal(redriven.outbox.id, created.outbox.id);
  assert.equal(redriven.outbox.integrationEventId, created.event.id);
  assert.equal(redriven.outbox.attemptCount, dead?.attemptCount);
  assert.equal(redriven.outbox.status, "pending");
  assert.equal(redriven.evidence.actorId, "admin-1");
  assert.equal(redriven.evidence.reasonCode, "provider_fixed");
});

test("WORKHUB inbound booking confirmation reuses the generic inbound webhook foundation", async () => {
  const confirmed: unknown[] = [];
  const service = new InboundWebhookService({
    environment: "test",
    store: new InMemoryInboundWebhookReceiptStore(),
    verifier: verifiedBooking(),
    mapper: new WorkhubTravelBookingConfirmationMapper(),
    handler: new WorkhubTravelBookingConfirmationHandler({
      async confirmBooking(command, context) {
        confirmed.push({ command, context });
      },
    }),
    clock,
    idGenerator: ids(),
  });

  const result = await service.handle({ providerKey: "reference", headers, rawBody });
  assert.equal(result.kind, "processed");
  assert.deepEqual(confirmed, [{
    command: { travelRequestId: "travel-1", bookingReference: "BOOK-001" },
    context: { receiptId: "id-1", environment: "test" },
  }]);
});

test("WORKHUB proves outbound approval and inbound booking confirmation as two integration directions", async () => {
  const store = new InMemoryIntegrationEventStore();
  const eventService = new IntegrationEventService(store, clock, ids());
  const instance: WorkflowInstanceRecord = {
    id: "workflow-1",
    environment: "test",
    resourceType: "travel_request",
    resourceId: "travel-1",
    definitionKey: "workhub.travel_request_approval",
    definitionVersion: 1,
    requesterId: "aoi",
    state: "completed",
    currentStepKey: null,
    returnedStepKey: null,
    version: 2,
    nextWorkItemSequence: 2,
    nextTransitionSequence: 3,
    submissionKey: "submit-1",
    createdAt: "2026-10-04T12:00:00.000Z",
    updatedAt: "2026-10-04T12:59:00.000Z",
    completedAt: "2026-10-04T12:59:00.000Z",
  };
  const outbound = new WorkhubTravelApprovedIntegrationSink(
    { async getInstance() { return instance; } },
    eventService,
    "travel-webhook",
  );
  const transition: WorkflowTransitionRecord = {
    id: "transition-approve-1",
    environment: "test",
    workflowInstanceId: "workflow-1",
    workItemId: "work-item-1",
    sequence: 2,
    transition: "approve",
    actorId: "ren",
    fromState: "active",
    toState: "completed",
    fromStepKey: "manager_approval",
    toStepKey: null,
    definitionVersion: 1,
    reasonCode: null,
    comment: null,
    requestId: "request-approve-1",
    correlationId: "correlation-1",
    occurredAt: "2026-10-04T12:59:00.000Z",
  };
  await outbound.emit(transition);
  const outboundEvent = await store.getEvent("transition-approve-1", "test");
  assert.equal(outboundEvent?.eventType, "travel.approved");
  assert.equal(outboundEvent?.schemaVersion, 1);

  const inboundMapper = new WorkhubTravelBookingConfirmationMapper();
  const inboundCommand = inboundMapper.map({
    providerKey: "reference",
    providerEventId: "booking-1",
    replayKey: "booking-1",
    eventType: WORKHUB_TRAVEL_BOOKING_CONFIRMED_EVENT_TYPE,
    occurredAt: "2026-10-04T13:00:00.000Z",
    payload: { travelRequestId: "travel-1", bookingReference: "BOOK-001" },
  });
  assert.deepEqual(inboundCommand, { travelRequestId: "travel-1", bookingReference: "BOOK-001" });
});
