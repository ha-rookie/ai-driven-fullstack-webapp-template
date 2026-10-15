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

Permanent adapter failures move the Outbox to `dead_letter`. **Only provider-verified non-delivery** may be returned as `retryable_failure` and move to `retry_wait`; #51 then owns retry execution. An adapter must never classify a network timeout, exception, or ambiguous provider response as proven non-delivery.

## Adapter outcome payload validation — #419/#430

Provider Adapters are a runtime trust boundary; TypeScript types alone do not validate JavaScript, third-party SDK or network-derived results. `relayOutboxOnce` only acts on explicit `delivered`, `retryable_failure` or `permanent_failure` discriminators. For failure kinds, the optional `failureCode` must be one of the **versioned safe codes** recognized by the relay (including reference-only `temporary` / `provider_rejected`), never a raw Provider message or credential. A missing code uses its known kind-specific generic code. A present malformed/unrecognized code never reaches D1 or jobs: the outcome is quarantined as `delivery_outcome_unknown`.

An optional `retryAfterMs` must be a positive safe integer when supplied; absent means the existing default (30 seconds), and a valid large value is capped at 24 hours. A present zero/negative/non-numeric/unsafe value is not interpreted as permission to retry. A malformed recognized-kind result, like a missing/unrecognized kind, is quarantined as UNKNOWN, not rescheduled. This is runtime-shape validation, **not** proof that an adapter truthfully classified non-delivery: adapters must independently substantiate `retryable_failure`, and actual Provider receipt reconciliation remains unimplemented.

## UNKNOWN external delivery outcome — #419/#430 fail-safe

If the adapter throws (including timeout after the request may have reached the provider), explicitly reports `unknown`, or returns a **missing / unrecognized runtime outcome** (for example, a malformed Provider response), `relayOutboxOnce` records the durable `dead_letter` status with the **distinguishing** safe failure code `delivery_outcome_unknown`. This is a **quarantine for investigation**, not proof of permanent rejection or proof of failure. The #51 job classifies this result as non-retryable so an automatic scheduled re-send cannot duplicate a possibly accepted external side effect. A repeat relay call will see terminal `dead_letter` and will not invoke the Provider again.

The existing generic `redriveDeadLetterOutbox` helper **unconditionally denies** records with `delivery_outcome_unknown`, even if a caller supplies an authorizer that returns true. This safeguard cannot be bypassed by `reasonCode`, an authorization decision, or advancing a clock. A future #419 integration reconciliation flow must independently verify Provider-side receipt/outcome, include appropriate idempotency and auditable authorization, and only then define a distinct safe transition. **No automatic reconciliation, Provider query, approval issuance, or actual re-send is implemented here**; #335 adapters are still required for real Provider evidence.

Other existing explicit `retryable_failure` adapter results retain the normal backoff behavior, but adapters MUST guarantee no external side effect when emitting them. The system does not offer exactly-once delivery; callers still need stable identities, deduplication, and Provider-specific receipts.

## Local integration failure queue (#419 operator view)

The Admin Operations Overview combines **local** Outbox (`retry_wait` / `dead_letter`) and verified inbound webhook receipt (`failed` / `dead_letter`) records in one bounded, environment-scoped, authorized read-only failure queue. An entry opens its existing separately authorized local detail endpoint. It is **not** a Provider-side error history, an external-storage monitor or proof that the Provider accepted or rejected a message. A zero-row result does not imply healthy integrations.

The UI displays the server's `observedAt` time (not a guaranteed snapshot or SLA time) and has an explicit **refresh this queue** control. Refresh and moving between pages clear the previously selected detail before the next read, so an older row is not mistaken for the current list entry. A denied, malformed or unavailable read must remain unavailable, never be represented as a healthy zero. Refresh performs only the existing GET and must not trigger delivery, replay, reconciliation or any other remote side effect.

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
