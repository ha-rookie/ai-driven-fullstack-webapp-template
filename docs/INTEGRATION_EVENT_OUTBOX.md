# Integration Event / Outbox Foundation

## Purpose

This foundation separates an internal Domain Event from a versioned Integration Event and a durable Outbox delivery record.

```text
Domain / Business event
        ↓ mapper
Integration Event
        ↓
Outbox Record
        ↓
Async Job #51
        ↓
Delivery Adapter
        ↓
External system
```

It does not promise exactly-once delivery. Adapters and consumers must tolerate at-least-once delivery.

## Source-of-truth boundaries

- Business State: domain/workflow store
- Integration Event: externally publishable versioned fact
- Outbox: delivery source and delivery state
- Async Job: lease, execution retry/backoff, terminal job state
- Audit: accountability/investigation
- Timeline: user-facing business history
- Notification: a specific user's now-you-should-know projection

Do not collapse these into one table or reconstruct Business State from the Outbox.

## Event contract

An Integration Event uses a stable `eventType` plus numeric `schemaVersion` rather than exposing an internal workflow transition directly.

Example logical contract:

```text
Domain: workflow.approve
Integration: eventType=travel.approved, schemaVersion=1
```

The stored payload is bounded and intentionally simple. Credential-like top-level fields are rejected. Authorization headers, cookies, passwords, sessions, tokens, secrets, or raw provider responses must not be copied into an Integration Event.

## Outbox lifecycle

```text
pending
  ↓ claim by optimistic CAS
processing
  ├─ delivered
  ├─ retry_wait
  └─ dead_letter
```

`availableAt` is a minimum delivery eligibility time. It can preserve a provider Retry-After hint, but it is not a second general-purpose retry engine. #51 Async Job remains responsible for worker lease, retry attempts, backoff, and terminal job handling.

## D1 durability boundary

`D1IntegrationEventStore.createEventWithOutbox()` inserts the Integration Event and its Outbox Record with one D1 `batch()` call. This prevents the foundation itself from intentionally creating only one side of the pair.

This alone does **not** prove that an arbitrary Business Mutation and the Outbox insert are in one transaction. A project that requires strict transactional-outbox semantics must compose its Business Mutation and Outbox insert inside the same storage transaction/durability boundary.

The WORKHUB workflow reference currently maps an already-established completed approval into an Integration Event after the workflow transition. That reference demonstrates event-contract separation and durable delivery state, but it must not be described as atomic Workflow+Outbox commit.

## Duplicate and failure semantics

The same `(environment, integrationEventId, destinationKey)` is unique. A deterministic source event ID can therefore suppress duplicate projection for one destination.

External delivery happens before the local Outbox can be marked `delivered`. A crash or CAS conflict after the provider accepted the request can cause a later retry. This is an inherent at-least-once boundary. Provider adapters should use the stable event identity as an idempotency key when the provider supports it.

Permanent adapter failures move the Outbox to `dead_letter`. Retryable failures move it to `retry_wait`; #51 then owns retry execution.

## Environment isolation

Integration Event and Outbox primary/unique keys include `environment`. Preview and Production must not share destinations, secrets, or endpoints by implicit fallback.

## WORKHUB reference

`WorkhubTravelApprovedIntegrationSink` maps only a completed TravelRequest approval to:

```text
eventType: travel.approved
schemaVersion: 1
aggregateType: travel_request
```

It reads the current Workflow Instance server-side to resolve the resource and requester. It does not publish the full internal Workflow transition as the external contract.

## Production safety

This implementation adds schema/migration definitions only. It does not:

- run Production migrations
- create Production queues
- register webhook endpoints or secrets
- create SaaS/Calendar/Chat resources
- re-drive Production dead letters

Those operations remain Human Gate actions.

## Not yet implemented in this stage

The parent #304 also covers inbound webhook transport, signature verification, replay protection, inbound receipt persistence, and provider-specific outbound webhook security. Those remain follow-up work; this outbound MVP is not sufficient by itself to close the whole #304 scope.
