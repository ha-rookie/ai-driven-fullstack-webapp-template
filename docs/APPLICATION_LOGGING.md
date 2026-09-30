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

`timestamp` is UTC ISO-8601 and defaults to the shared `systemClock`. Supply a test sink and `createFixedClock(...)` to test deterministically. `component` and `message` must be **developer-authored static identifiers**; do not interpolate request inputs, tokens, exception messages or response bodies. Generic string/content redaction is not implemented yet.

## Request scope

A shared logger instance may create an immutable request-scoped instance:

```ts
const requestLogger = new StructuredApplicationLogger("worker.http")
  .withContext({ requestId: requestContext.requestId });

requestLogger.warn("dependency_unavailable");
```

Safe optional context fields are `requestId`, `actorId` and `scopeId` only. They must be strings using a restricted character set and at most 128 characters. Per-event safe context overrides request defaults; other request scopes cannot inherit those values.

The serializer explicitly projects allowed fields; it never recursively serializes arbitrary context objects. Unrecognized values (e.g., `token`, `cookie`, `authorization`, `requestBody`, arbitrary metadata) are ignored. This provides a narrow safe baseline, not full DLP.

## Error diagnostics

The optional `error` context field accepts an actual `Error`. Only its recognized standard error class (e.g., `TypeError`) is serialized. The original `message`, `stack`, `cause`, `code`, custom properties and non-Error throwable values are not logged. Developers must use a static diagnostic `message` identifier to retain useful operational context without leaking dependency strings.

The logger drops failures from serialization, clocks or sinks. Logging failure must not change a business/API response. This best-effort approach is a baseline; products with strict logging guarantees must design stronger delivery separately.

## Current Worker connection

The database health endpoint uses a request-scoped logger for unexpected failures and unavailable probe results. The request ID is the same ID attached to the HTTP response. A successful health request does not emit an application log.

The HTTP response and existing Audit integration are unchanged.

## Follow-up boundary: #65 Log Redaction

Issue #65 adds the reusable pure redactor for secret keys, nested objects, maximum depth/length, and shared Application/Audit integration. **Until #65 is complete, do not add arbitrary metadata, free-form messages, complete exception objects or request/response contents to the Application Logger.** No data from a user-controlled source should be passed as `component` or `message`.

## Tests

Tests cover the JSON format and all levels; UTC timestamp; request inheritance and isolation; unknown/secret context exclusion; safe error type projection; invalid context; logging sink failures; and console dispatch. Existing runtime/boundary CI remains the integration gate.
