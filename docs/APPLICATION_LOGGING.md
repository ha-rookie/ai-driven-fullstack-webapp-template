# Structured Application Logging

## Responsibility

This baseline adds **Application Log**, distinct from the existing **Audit Event** contract.

- Application Log: runtime and dependency diagnostics, with an optional request correlation ID
- Audit: accountability for actor, operation and outcome; use `AuditEvent` and `writeAuditSafely`
- Traffic analytics, durable storage, retention and alerting remain separate work

Do not turn diagnostic messages into audit records or use application logs as evidence of accountability.

## Contract

`StructuredApplicationLogger` implements the existing shared `Logger` interface (`debug / info / warn / error`). Every call emits one JSON line via the console sink by default:

```json
{"kind":"application","timestamp":"2026-09-30T00:00:00.000Z","level":"warn","component":"worker.http","message":"database_health_check_unavailable","requestId":"request-1"}
```

`timestamp` is UTC ISO-8601 and defaults to the shared `systemClock`. Supply a test sink and `createFixedClock(...)` to test deterministically. `component` and `message` must be **developer-authored static identifiers**; do not interpolate request inputs, tokens, exception messages or response bodies.

## Request scope

A shared logger instance may create an immutable request-scoped instance:

```ts
const requestLogger = new StructuredApplicationLogger("worker.http")
  .withContext({ requestId: requestContext.requestId });

requestLogger.warn("dependency_unavailable");
```

Safe optional context fields are `requestId`, `actorId` and `scopeId` only. They must be strings using a restricted character set and at most 128 characters. Per-event safe context overrides request defaults; other request scopes cannot inherit those values.

The serializer explicitly projects allowed fields; it never recursively serializes arbitrary context objects. Unrecognized values (e.g., `token`, `cookie`, `authorization`, `requestBody`, arbitrary metadata) are ignored. This provides a narrow safe baseline, not full DLP.

## Shared output redaction (#65)

`redactLogValue(...)` in `src/shared/logging/redaction.ts` is a pure, detached JSON-safe projection shared with the Audit console sink. Both loggers apply it **after** their existing explicit record/context projection and **before** `JSON.stringify` and the sink. Existing allowlists are not relaxed.

- Normalize keys case-insensitively, ignoring separators: Authorization, Cookie, Set-Cookie, passwords, tokens, secrets, API/private keys, request/response bodies, credentials, and candidate PII fields such as email, phone and address become `[REDACTED]`
- Recursively handle nested plain objects and arrays; sensitive values are not visited
- Fixed upper limits: depth 4; 256 UTF-16 code units per string; 64 per object key; 20 items per collection; 128 visited nodes
- Large keys are replaced by generated `[TRUNCATED_KEY_n]` placeholders, and excessive depth, strings, entries, cycles or nodes are marked `[TRUNCATED]`
- Accessor values, `toJSON` functions, Error objects, Date/class instances and unsupported values are never serialized from arbitrary objects
- Source objects are never mutated. A logging failure still cannot break business handling

This is **key-based defense in depth**, not full text scanning or DLP. It cannot guarantee removal of passwords/PII embedded in ordinary string values, allowed identifiers, or caller-controlled property names. Continue using developer-authored static `component` and `message` strings; never include untrusted request/response bodies or arbitrary exception messages.

## Error diagnostics

The optional `error` context field accepts an actual `Error`. Only its recognized standard error class (e.g., `TypeError`) is serialized. The original `message`, `stack`, `cause`, `code`, custom properties and non-Error throwable values are not logged. Developers must use a static diagnostic `message` identifier to retain useful operational context without leaking dependency strings.

The logger drops failures from serialization, clocks, redaction or sinks. Logging failure must not change a business/API response. This best-effort approach is a baseline; products with strict logging guarantees must design stronger delivery separately.

## Current Worker connection

The database health endpoint uses a request-scoped logger for unexpected failures and unavailable probe results. The request ID is the same ID attached to the HTTP response. A successful health request does not emit an application log.

The HTTP response and existing Audit integration are unchanged.

## Tests

Tests cover the JSON format and all levels; UTC timestamp; request inheritance and isolation; unknown/secret context exclusion; safe error type projection; nested/key-based redaction; bounded large and cyclic inputs; output failure isolation; and console dispatch. Existing runtime/boundary CI remains the integration gate.
