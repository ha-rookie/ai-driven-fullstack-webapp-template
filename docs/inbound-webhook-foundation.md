# Inbound Webhook Foundation

Issue: #304 Stage 2

## Purpose

Provide a provider-neutral inbound webhook boundary without allowing provider payloads, signatures, or retry behavior to become application-domain truth.

```text
HTTP request
  -> transport validation
  -> provider verifier (raw body)
  -> replay-scoped receipt
  -> mapper / validation
  -> business service
```

## Inputs

- `providerKey`
- provider-specific headers exposed through `InboundWebhookHeaders`
- raw request body as `Uint8Array`
- injected `InboundWebhookVerifier`
- injected mapper and business handler

The Core does not know Stripe, Slack, Teams, Google, or other provider-specific signature semantics.

## Stop Conditions

Reject before business mapping when:

- provider key is invalid
- body is empty or exceeds the configured limit
- provider verification fails
- verifier returns a different provider identity
- replay key or event type is invalid

Do not silently treat an unverified provider as verified.

## Receipt / Replay Semantics

`inbound_webhook_receipts` stores only bounded processing metadata:

- environment
- provider key
- provider event id when available
- provider-scoped replay key
- event type / timestamps
- processing status / attempt count / failure code

It does **not** store raw body, Authorization headers, signing secrets, or signatures.

`UNIQUE(environment, provider_key, replay_key)` prevents one provider delivery identity from becoming multiple receipt identities.

Processed / ignored / dead-letter redelivery is acknowledged as duplicate without re-running business mutation. A receipt in `failed` may be attempted again only when the previous processing failure was classified retryable. Non-retryable failures move to `dead_letter`.

Business handlers still need application-level idempotency when partial mutation is possible. Receipt dedupe is not a replacement for business transaction design.

## #51 Async Job Boundary

The baseline service processes the verified event synchronously.

Some providers require a fast 2xx response. A project adapter may extend the flow to:

```text
verify raw request
  -> persist durable receipt / bounded mapped command
  -> enqueue #51 async job
  -> only then acknowledge
```

Rules for that extension:

- do not enqueue raw webhook bodies by default
- do not enqueue secrets, signatures, Authorization headers, cookies, or provider credentials
- enqueue a bounded verified/mapped command with an idempotency key derived from receipt identity
- do not return success before the selected durability boundary has succeeded
- use #51 for lease / retry / bounded dead-letter execution rather than building a second retry engine

Stage 2 does not create a Production Queue or provider endpoint.

## Validation

Tests should prove:

- signature/verification failure never reaches mapper or business handler
- duplicate successful delivery does not duplicate business mutation
- retryable failed delivery can resume with the same receipt identity
- non-retryable failure becomes dead letter
- environment + provider + replay key define replay scope
- raw payload is not persisted in Receipt state
- D1 migration and Production schema baseline remain aligned

## Evidence

The Draft PR for Stage 2 is the implementation evidence and recovery point. Required GitHub Actions must be green before merge.

## Do Not

- do not verify signatures against re-serialized JSON when provider specs require raw bytes
- do not invent provider cryptography in Template Core
- do not trust user/role/resource identifiers from provider payload as authorization
- do not persist secrets or raw sensitive response/request bodies for convenience
- do not promise exactly-once delivery or processing
- do not mutate Production endpoint/secret/queue resources without Human Gate
