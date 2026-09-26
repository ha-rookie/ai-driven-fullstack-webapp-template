# Audit & Correlation

## Purpose

Provide a reusable request-correlation and accountability baseline for the Full-stack Template without mixing Audit with traffic analytics or general application logging.

The implementation is derived from the Mahjong Score application's Worker audit pattern, but uses generic actor/scope/resource identifiers and no Mahjong-specific vocabulary.

## Responsibility split

```text
Traffic Analytics
  -> visits / referrers / device / web performance

Application Log
  -> validation / dependency / internal runtime diagnostics

Audit Log
  -> who / what / operation / result / accountability

Correlation ID
  -> connects one API request across responses and logs
```

These concerns may share infrastructure later, but they are not the same data contract.

## Request correlation

Every `/api/*` request receives a request ID using this order:

```text
CF-Ray
  ↓ if absent/invalid
x-request-id
  ↓ if absent/invalid
crypto.randomUUID()
```

Rules:

- `CF-Ray` is preferred when Cloudflare supplies it
- client-provided `x-request-id` is accepted only when it is at most 128 characters and contains only letters, digits, `.`, `_`, `:`, or `-`
- malformed or oversized request IDs are not echoed back
- query parameters are not copied into the Request Context; only the URL pathname is retained
- the resolved ID is returned on API responses as `x-request-id`
- non-API Static Asset responses are outside this correlation baseline

The correlation ID is not an authentication credential and must never be derived from a token, Cookie, password, or request body.

## Audit event contract

Baseline Audit records contain only bounded fields:

```text
kind = audit
timestamp
category
action
outcome
requestId
method
path
actorId? 
scopeId?
resourceType?
resourceId?
reason?
```

Categories are:

- `authentication`
- `authorization`
- `mutation`
- `system`

Outcomes are:

- `success`
- `failure`

`actorId`, `scopeId`, and resource identifiers are generic contracts. Projects decide which identifiers are justified for accountability.

The serializer explicitly projects the allowed fields instead of blindly serializing the caller object. This prevents accidental extra properties from entering the baseline Audit record.

## Sensitive data policy

Do not put the following into the Audit contract:

- passwords or secrets
- session tokens or token hashes
- OAuth authorization codes
- Cookie headers
- Authorization headers
- full request or response bodies
- free-form memo/content fields
- unnecessary display names, email addresses, or other PII

A project that needs extra Audit metadata must explicitly define why it is required, whether it is personal data, and how long it is retained.

## Output sink

The baseline sink writes one JSON record per event through Worker `console.info`.

```text
AuditEvent
   ↓ explicit field projection
StructuredAuditRecord
   ↓ JSON.stringify
console.info
```

This keeps the template deployable without provisioning another service or D1 table.

Durable Audit storage is an Operations decision because it requires explicit choices for:

- retention
- access control
- searchability
- export
- cost/quota
- privacy
- deletion policy

## Failure isolation

Audit writing is best-effort in the baseline.

A sink failure must not turn an otherwise valid Core operation into a business failure. `writeAuditSafely(...)` catches sink failures at the boundary.

This does **not** mean Audit reliability is unimportant. A project with regulatory or contractual requirements may deliberately choose a stronger transactional Audit design, but that is outside the generic baseline.

## Current Worker integration

Issue #15 connects Audit to the existing authentication boundary:

- missing/invalid application session on `/api/auth/me`
  - category: `authentication`
  - action: `session_resolve`
  - outcome: `failure`
- authentication dependency failure
  - category: `authentication`
  - action: `session_resolve`
  - outcome: `failure`
- logout completion/failure
  - category: `authentication`
  - action: `logout`
  - resource type: `application_session`

Successful read-only `/api/auth/me` requests are not audited by default to avoid producing low-value high-volume logs.

Authorization and Runtime Integrity do not yet have concrete HTTP endpoints in the template. Their future boundary handlers should use the same Audit contract for authorization denials and important mutation results.

## Testing

Unit tests verify:

- `CF-Ray` priority
- validated client request IDs
- fallback for malformed or oversized IDs
- query data excluded from Request Context
- response request-ID propagation
- explicit Audit field projection
- generic authentication / authorization / mutation categories
- Audit sink failure isolation

Runtime smoke tests also verify `x-request-id` propagation on success, authentication failure, logout, and API 404 responses.

Remote log ingestion is not part of baseline CI.
