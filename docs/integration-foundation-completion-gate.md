# Integration Foundation Completion Gate

Issue: #304 Stage 4

## Purpose

Close only the remaining safety and reuse gaps after:

- Stage 1: Integration Event / durable Outbox / #51 relay
- Stage 2: Inbound Webhook verification / receipt / replay boundary
- Stage 3: Outbound Webhook SSRF / destination / signing boundary

Stage 4 does not add a real SaaS integration. It proves that the generic contracts can be composed safely and reused in both directions.

## Security Rejection Boundary

Inbound verification rejection can be mapped into the existing #91 `SecurityRejectionEvent` contract.

Examples:

- `invalid_signature` -> `webhook_signature_invalid`
- verifier-classified `replay_rejected` -> `webhook_replay_rejected`
- provider mismatch -> `webhook_provider_mismatch`

The event carries request correlation context but never the raw body, signature, Authorization header, or secret.

A normal provider retry that reaches the Receipt Store and resolves to an already processed receipt is a delivery duplicate, not automatically a security incident. This avoids turning ordinary at-least-once delivery into alert noise.

Failure to record a Security Rejection Event must not turn an invalid webhook into an accepted webhook. The original verification rejection remains authoritative.

## Secret Rotation Boundary

`InboundWebhookVerificationKeyResolver` returns bounded key references, not raw keys.

A verifier may ask for current and previous candidates during an overlap window:

```text
provider request
  -> key hint / receivedAt
  -> VerificationKeyResolver
  -> current secretRef + previous secretRef
  -> provider verifier / secret manager
```

The Core does not load or expose the underlying secret value and does not choose a cryptographic algorithm. Candidate count is bounded to avoid unbounded key probing.

## Dead-letter Re-drive

`redriveDeadLetterOutbox()` is deliberately separate from automatic retry.

Rules:

- only `dead_letter` may be re-driven
- an explicit authorizer is mandatory
- original Integration Event ID and Outbox ID are preserved
- previous attempt count is preserved
- delivery state returns to `pending`
- actor + reason + timestamp evidence is returned for Audit integration
- CAS protects against concurrent re-drive
- no automatic infinite re-drive
- Production re-drive remains a Human Gate decision

The helper does not claim Audit and re-drive are one atomic transaction. Projects should persist the returned evidence using the existing Audit foundation according to their operational policy.

## Two Reference Integration Directions

### Outbound

WORKHUB approval already maps:

```text
workflow.approved
  -> WorkhubTravelApprovedIntegrationSink
  -> travel.approved v1
  -> Integration Event / Outbox
```

### Inbound

Stage 4 adds a Reference-only booking confirmation mapping:

```text
verified provider event
  -> travel.booking_confirmed
  -> WorkhubTravelBookingConfirmationMapper
  -> WorkhubTravelBookingConfirmationCommand
  -> injected business service
```

The business-specific terms stay in `src/reference/workhub`; the generic Inbound Webhook Core remains provider- and product-neutral.

## Completion Gate Mapping

- Provider-neutral Integration Event / Outbox: Stage 1
- Domain Event / Integration Event / Outbox / Queue separation: Stage 1
- at-least-once + idempotency: Stages 1–2
- retry / dead-letter: Stages 1–2
- explicit re-drive boundary: Stage 4
- outbound Delivery Adapter: Stages 1 + 3
- inbound verification / mapping: Stage 2
- signature verification boundary + replay protection: Stage 2
- secret rotation boundary: Stage 4
- existing #51 / #91 / Audit-compatible contracts reused: Stages 1–4
- two Integration directions demonstrated in WORKHUB: Stage 4

## Human Gate

Stage 4 does not:

- register a real provider secret
- activate a public provider endpoint
- run a Production migration
- create or mutate a remote Queue/Cloudflare resource
- perform a Production re-drive

Those remain explicit Human Gate operations.
