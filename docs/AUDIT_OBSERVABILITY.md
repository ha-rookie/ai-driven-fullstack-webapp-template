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
affectedCount?
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

`affectedCount` is an optional non-negative safe integer for operations where the number of changed records is part of the accountability result, such as bulk session revocation. It is not a general-purpose metadata container. Invalid numeric values are omitted from the serialized Audit record.

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

## Session revocation events

Bulk Session Revocation uses `createSessionRevocationAuditEvent(...)` to produce a bounded success record from the service result.

Reference actions are:

```text
session_revoke_all
session_revoke_others
```

Reference fields are:

```text
category      authentication
outcome       success
actorId       authenticated actor id
resourceType  application_session
resourceId    target user id
affectedCount revoked session count
```

The revocation helper receives only the bounded `SessionRevocationResult`; raw session tokens, token hashes, and Cookie headers are not part of that result and therefore cannot be serialized by the helper.

Administration boundary failures remain the caller's responsibility. The future Administration API must record authorization/dependency failures using the normal bounded Audit contract rather than placing exception text or credentials into `reason`.

## Session rotation events

Session Rotation uses `createSessionRotationAuditEvent(...)` as the provider-neutral connection point for login, authentication-level changes, or future privilege-boundary changes.

The reference action is:

```text
session_rotate
```

Success records use:

```text
category      authentication
outcome       success
actorId       internal user id
resourceType  application_session
resourceId    internal user id
```

Failure records may use only controlled reasons from the Session Rotation contract, plus `dependency_error` at an outer HTTP/provider boundary. Exception text, raw session tokens, token hashes, and `Set-Cookie` values must not be copied into `reason` or any other Audit field.

The rotation helper intentionally receives `userId`, `outcome`, and controlled `reason` separately. It does **not** receive the Rotation service result because that result contains the browser `Set-Cookie` value.

## Output sink

The baseline sink writes one JSON record per event through Worker `console.info`.

```text
AuditEvent
   ↓ explicit field projection
StructuredAuditRecord
   ↓ shared redactLogValue (key masking and size limits)
Detached JSON-safe record
   ↓ JSON.stringify
console.info
```

Issue #65 shares the same pure `src/shared/logging/redaction.ts` utility with the Application Logger. It masks known secret/cookie/token and PII-candidate **keys**, recursively handles nested plain data and applies fixed limits (depth 4; string length 256; key length 64; collection entries 20; visited nodes 128). Excess or cyclic data uses `[TRUNCATED]`; known sensitive keys use `[REDACTED]`.

The Audit contract stays explicitly allowlisted, and `toStructuredAuditRecord` still returns the original bounded **unredacted** projection for internal composition. **Only the `ConsoleAuditLogger.write` sink is the documented redacted output boundary.** Do not serialize intermediate records or pass an arbitrary AuditEvent to an alternative sink without applying the same redactor. `writeAuditSafely` continues isolating sink failures.

Key-based redaction is not complete PII/DLP detection. Use controlled `action`, `reason`, `resourceId` and `path` values. Do not put tokens, email addresses or user-generated text inside permitted string fields. For Application Logger guidance, see `APPLICATION_LOGGING.md`.

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

## Operation mode change projection (#117)

`AuditEvent.operationModeChange` is an optional, explicitly projected accountability payload for `operation_mode.update`: environment, beforeMode, afterMode, beforeVersion, afterVersion and operator reason. Modes/environments must be from the shared contracts; versions must be positive safe integers with afterVersion exactly beforeVersion + 1. The reason is bounded to 200 non-control characters. Invalid payloads are omitted; arbitrary extra fields are never serialized. This is a narrow operational metadata exception to the general prohibition on copying user text into Audit: reasons must contain no credentials, request bodies or unnecessary personal information, and shared redaction still applies.

The actor/scope/request context remains in standard fields. Failed changes use controlled reasons without the operator input or exception text. The baseline sink remains best-effort and isolated from mutation results; this field does not claim durable or atomic Audit persistence (see #44).

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

Issue #71 adds a reusable Audit builder for successful user-level bulk Session Revocation. Issue #88 adds the corresponding provider-neutral Session Rotation Audit builder. Neither issue adds a new public Administration/provider endpoint; those HTTP boundaries remain later concerns.

Successful read-only `/api/auth/me` requests are not audited by default to avoid producing low-value high-volume logs.

## Testing

Unit tests verify:

- `CF-Ray` priority
- validated client request IDs
- fallback for malformed or oversized IDs
- query data excluded from Request Context
- response request-ID propagation
- explicit Audit field projection
- non-negative integer `affectedCount` projection and invalid-value omission
- shared key-based redaction and size limits at the Audit sink
- generic authentication / authorization / mutation categories
- Session Revocation event shape without token/Cookie fields
- Session Rotation success/failure event shape without token/hash/Cookie fields
- Audit sink failure isolation

Runtime smoke tests also verify `x-request-id` propagation on success, authentication failure, logout, and API 404 responses.

Remote log ingestion is not part of baseline CI.
