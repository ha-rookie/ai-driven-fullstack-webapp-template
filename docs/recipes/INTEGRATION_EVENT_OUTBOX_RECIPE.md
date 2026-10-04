# Integration Event / Outbox Recipe

Use this recipe when a business event must eventually reach an external adapter without treating the external call as part of the local database transaction.

## 1. Define a versioned external contract

Do not expose a Domain Event mechanically. Map it explicitly.

```ts
const created = await integrationEvents.enqueue({
  environment,
  eventType: "travel.approved",
  schemaVersion: 1,
  destinationKey: "calendar",
  aggregateType: "travel_request",
  aggregateId: request.id,
  occurredAt: transition.occurredAt,
  causationId: transition.id,
  payload: {
    travelRequestId: request.id,
    requesterId: request.requesterId,
  },
  eventId: transition.id,
  outboxId: transition.id,
});
```

Use a deterministic source identity when one source event must create at most one delivery record per destination.

## 2. Keep credentials out of the payload

The Integration Event contains business facts needed by the external contract. It must not contain access tokens, passwords, cookies, authorization headers, webhook secrets, or raw provider credentials.

## 3. Persist before delivery

The Outbox record is the durable delivery source. Do not call the external provider first and create the Outbox afterward.

For strict transactional-outbox semantics, compose the business mutation and Outbox insert in the same local storage transaction. `createEventWithOutbox()` only guarantees the Event/Outbox pair is created together; it cannot make an already-completed business transaction atomic retroactively.

## 4. Create the #51 relay job

```ts
const envelope = await createIntegrationOutboxRelayJobEnvelope({
  environment,
  outboxId: created.outbox.id,
  correlationId,
});
```

Submit the envelope through the project's existing Async Job publisher. The job handler calls the configured `IntegrationDeliveryAdapter`.

## 5. Classify provider outcomes

Adapters return one of:

```text
delivered
retryable_failure
permanent_failure
```

Use `retryable_failure` only when another attempt can reasonably succeed. Provider `Retry-After` can be translated into `retryAfterMs` with a bounded value.

Do not retry indefinitely on schema errors, disabled destinations, or authentication misconfiguration.

## 6. Expect at-least-once delivery

A provider can accept a request immediately before the Worker crashes or before the Outbox status update commits. A later retry can therefore deliver the same Integration Event again.

Where supported, pass the stable Integration Event identity to the provider as its idempotency key. Otherwise design the consumer to deduplicate safely.

## 7. Production checklist

Before enabling a real destination:

- configure Preview and Production destinations separately
- store secrets outside normal business tables/logs
- validate outbound URL/SSRF policy for configurable webhooks
- define provider timeout and retry classification
- decide dead-letter re-drive ownership
- add Audit for privileged Production re-drive if required
- perform Production migration/resource changes only through the Human Gate
