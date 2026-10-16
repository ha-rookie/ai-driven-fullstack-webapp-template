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

## Provider receipt evidence assessment — #419 / #335 prerequisite

An ambiguous external delivery outcome remains `dead_letter + delivery_outcome_unknown`: generic redrive still **denies** it. The new `assessOutboxProviderReceipt` is deliberately **read-only**. It accepts an explicitly registered trusted Provider receipt verifier from application composition (no verifier is currently wired) and queries it using only the exact local `environment / outboxId / integrationEventId / destinationKey / version` identity. It never supplies event payloads or credentials to a browser, never calls a delivery adapter, and never transitions, retries or authorizes an Outbox.

A Provider verification observation must be backed by authoritative **positive receipt** (`delivered`) or **explicit terminal non-delivery proof** (`not_delivered`); Provider API `404`, timeout, unknown, partial lookup and ordinary absence of a receipt are **not** definitive non-delivery. The runtime assessment rejects untrusted/malformed extra fields, credential-like diagnostic data, mismatched identity/version/environment, future or stale timestamps, wrong proof basis, and concurrent Outbox version/status changes after the asynchronous lookup. Runtime proof fields are snapshotted once before the safe result is constructed; throwing JavaScript getters/proxies are treated as unavailable evidence, not leaked exceptions, and a getter that changes its value on reread cannot silently flip the assessed outcome. Adapter exceptions are safely reduced to `unverified` without leaking raw Provider responses. The response contains only a safe decision and evidence time; Provider-specific receipt IDs are not exposed.

Even if the assessment returns `verified_non_delivery`, `manualRetryAllowed` is **always false**. It is an observation for a **future** separately authorized/audited #429/#430 reconciliation/approval flow, not approval to redrive or an implemented durable verification record. In addition, the caller must enforce Session/Scope/Role/Environment before invoking any future admin route; this module is not an HTTP security gate.

**Current deployment:** no actual Google Drive, Microsoft Graph, Box, Dropbox, webhook Provider or Provider-native receipt verifier is configured under #335; `verifier` is therefore absent in the current composition and every call must safely report `provider_not_registered`. Test verifiers are synthetic and do not substantiate real Provider evidence. The #419 failed integration list/detail, safe actual retry/reconciliation and Browser/Provider integration acceptance remain **Open 2/5**, as does formal System Test #694 (Not Run). No new D1 schema, credential, Cloudflare resource, remote operation or Provider integration is introduced here.

## Local integration failure queue (#419 operator view)

The Admin Operations Overview combines **local** Outbox (`retry_wait` / `dead_letter`) and verified inbound webhook receipt (`failed` / `dead_letter`) records in one bounded, environment-scoped, authorized read-only failure queue. An entry opens its existing separately authorized local detail endpoint. It is **not** a Provider-side error history, an external-storage monitor or proof that the Provider accepted or rejected a message. A zero-row result does not imply healthy integrations.

The UI displays the server's `observedAt` time (not a guaranteed snapshot or SLA time) and has an explicit **refresh this queue** control. Refresh and moving between pages clear the previously selected detail before the next read, so an older row is not mistaken for the current list entry. A denied, malformed or unavailable read must remain unavailable, never be represented as a healthy zero. Refresh performs only the existing GET and must not trigger delivery, replay, reconciliation or any other remote side effect.

### Exact local failure ID investigation

When an operator already has a **local** Outbox or verified inbound receipt ID from an incident record, the console may open the existing separately authorized detail by selecting the source and entering the exact record ID. This is not a free-text Provider search or a way to enumerate records. The ID must conform to the existing local identifier format; the server's current Session/Role/Scope/Environment and exact-ID checks remain authoritative. The client only dispatches the existing read-only GET, and a missing/denied detail remains missing/denied. This lookup can be used when the current paginated local failure queue is empty, but not when the queue cannot be retrieved or its permission is denied; an empty result never proves Provider health. It does not initiate reconciliation or retry, and it does not validate external Provider receipt or storage status.

## Local unified failure queue acceptance evidence (#419)

The read-only unified queue is also checked through an **actual authenticated local Worker HTTP request**, not solely through the existing intercepted Browser UI fixtures. The targeted Browser acceptance covers server-bound scope/role authorization, fixed 20-item page shape, both local Outbox and inbound receipt source identifiers, no-store, `providerReceipt: unverified`, no manual retry capability, invalid/duplicate cursor rejection, and denial of a POST mutation. It may inspect independently protected existing detail routes when the local database actually contains a returned item.

The local seed may contain **zero failed records**. A green test with no rows proves only the local endpoint's safe empty/read-only behavior; it does not prove populated cross-source ordering, Provider receipt reconciliation, external document storage connection health, or a Production System Test. The broader #419 list/detail and end-to-end integration acceptance remain open until suitable evidence exists.

## #419 receipt evidence status on existing authorized Outbox detail (read-only)

The existing admin Outbox detail view now exposes an **operator-invoked read-only status check** for quarantined `dead_letter + delivery_outcome_unknown` records. This is not a retry or reconciliation executor:

- `GET /api/admin/integrations/outbox/:outboxId/_receipt?scopeId=workhub-company` reuses the existing session, `integrations:view` role, single-scope opt-in, runtime environment and exact-ID validation. Unknown/malformed IDs are rejected; a missing record returns 404. Other methods, including POST, return 405. Both successful status and unavailable states are noncacheable through the existing `no-store` response helper.
- The GET delegates to the existing `D1IntegrationEventStore` and `assessOutboxProviderReceipt` logic from PR #719, **not** a separately invented verifier. Unless an application explicitly registers a trusted `IntegrationOperationsOptions.providerReceiptVerifier`, this returns `{ kind: "unverified", reason: "provider_not_registered", manualRetryAllowed: false }` for the quarantined state. Non-UNKNOWN Outbox rows return `not_applicable` with no Provider lookup. The WORKHUB reference registers **no** verifier and does **not** claim an actual Provider acceptance.
- A registered read-only Provider lookup has to satisfy the existing strict source Event/Outbox identity, version re-read, exact checkedAt freshness and authoritative receipt/non-delivery proof. Missing/malformed/throwing/stale values fail closed. Response fields are limited to environment, Outbox identifier, observed time, the allowlisted assessment and `manualRetryAllowed:false`; **destinationKey, Provider raw responses, credentials and delivery payloads are never returned**.
- The detail UI displays a deliberately manual “受領証跡の状態を確認（参照のみ）” on UNKNOWN records, shows `Provider照合Adapter未登録／未確認／再送不可` on the reference deployment, and keeps both existing #429 `DELIVERY_RETRY` and `INTEGRATION_RECONCILE` DENY gates. Even future `verified_non_delivery` is **not** proof of authorization, audit durability, idempotency or side-effect safety for an actual retry.
- Existing populated local D1 Browser acceptance covers eligible/ordinary/missing records, invalid scope, rejected POST and the screen's fail-closed classification. **This is not a Provider-side acceptance test**. Real Provider integration belongs to #335, and execution approval, audit, concurrency and retry verification to #429/#430; formal ST #694 remains separate.

## Real local SQLite populated queue browser acceptance (#419)

The separate `e2e/tests/workhub-integration-populated.spec.ts` is an **actual local D1/SQLite + authenticated Vite/Worker HTTP + browser** regression for the existing unified failure queue. It creates dedicated `e2e419-` synthetic Outbox/Integration Event and inbound Webhook Receipt records **only in the local D1 database** using Wrangler's explicit `--local` flag, verifies source-aware 20+5 keyset pagination, existing Outbox/inbound detail GET, allowlisted failure code masking, scope denial, mutation denial and the operator UI's page/detail navigation. It cleans up the dedicated test rows before and after the scenario. It never invokes a delivery adapter, a real Provider, a Remote D1 or a mutation API.

The deterministic synthetic time is deliberately only a fixture ordering key and is **not** a Provider receipt, real monitoring timestamp or SLA. This closes the previous **test-data gap** between an optionally empty real-local Worker smoke and a populated D1 test-double service test. It does **not** close #419's remaining three checklist criteria: external Provider/storage-side failed integrations are still unconnected (#335), evidence-backed authorized reconciliation/retry is not implemented (#429/#430), and actual Provider-level Browser/Integration end-to-end acceptance is not verified. Formal authenticated System Test #694 remains separate and Not Run.

## Populated unified failure queue regression (#419)

A deterministic service-level test exercises the **real** authorized `handleIntegrationOperationsApi` handler with an in-memory D1 **test double**, populated with local outbound delivery and inbound verified receipt failures. The two sources share timestamps, so the test verifies source-aware keyset pagination across the 20-row boundary, safe failure-code normalization, exact separately authorized detail access, environment isolation, and the rule that **either source's read error invalidates the entire page** rather than producing a misleading empty or incomplete success. The handler remains GET-only with `providerReceipt: unverified`, and this test performs no Provider call or persistent write.

This is distinct from PR #716's browser test over a real local Worker and potentially empty local D1, and from mocked browser UI presentation scenarios. Because the in-memory test double is not SQLite, SQL query-plan/index performance and full seeded D1 cross-source behavior are **not** proven by this new test. Neither test provides actual external Provider receipt verification, document-storage connection monitoring, evidence-based external retry, or formal System Test #694. The full #419 list/detail and recovery acceptance remains open.

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
