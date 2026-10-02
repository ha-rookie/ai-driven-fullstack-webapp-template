# Operation Mode Store

## Boundary

Issue #116 provides an environment-specific D1 store for `normal`, `read-only` and `maintenance`. Issue #78 adds a reusable HTTP Guard below. These primitives are not enabled Worker routes. Admin API (#117) and Incident Response (#87) compose them deliberately.

Each row contains `environment`, `mode`, `version`, `updated_at`, `updated_by` and `reason`. Environment must be explicitly selected from the shared RuntimeEnvironment contract. The adapter never infers Production, falls back to another environment, or caches state across requests. Separate Preview / Production D1 bindings remain mandatory; row keys are an additional boundary, not a substitute for resource isolation.

## Initialization and updates

The migration creates an empty table. Provision state explicitly with `expectedVersion: 0`; it creates version 1 only if that environment has no row. Concurrent initialization cannot overwrite an existing mode. Update using the version actually observed by the caller. One conditional statement changes mode and metadata and increments version; stale requests return `conflict` without changing persisted state. All three modes can transition to each other; authorization and operational approval belong to the caller.

Actor identifiers and human-authored reasons must be bounded, non-empty and contain no control characters. Reasons are operational metadata, not a place for credentials or unnecessary personal information. The store records only the latest metadata; durable Audit history is a separate responsibility. The injected Clock supplies the timestamp, allowing deterministic testing.

## Fail-safe contract

Missing state, invalid persisted state or a D1 read/write failure raises `OperationModeUnavailableError` with a bounded reason and no SQL diagnostics. A caller must not interpret that error as `normal`. Future HTTP composition should deny protected operations with an unavailable response rather than allow a write based on unknown state. The store does not silently choose whether unrelated health/static routes remain available.

Invalid caller input raises TypeError before persistence. A conditional write returning no row is a conflict, not success. No automatic retry or fresh-version reacquisition occurs.

## Validation

Unit tests cover the adapter contract and error paths. `npm run operation-mode:local` exercises the actual adapter against Wrangler Local D1 in a dedicated temporary persistence directory, including environment isolation, optimistic concurrency and schema constraints. No remote resources or developer database reset is used. Production schema validation requires the new table and metadata columns; the numbered migration remains authoritative.

## HTTP Guard (#78)

`OperationModeGuard` accepts a Store, explicit deployment environment and a Project-defined positive `retryAfterSeconds`. It reads fresh state on each check. `normal` allows requests, `read-only` allows GET / HEAD / OPTIONS and rejects all other methods, and `maintenance` rejects every request presented to the Guard. Unsupported modes, mismatched environments and Store errors fail closed as unavailable.

Call the Guard before the protected operation; return `operationModeRejectionResponse` on rejection and do not call the business handler. Rejections use HTTP 503, standard API error / requestId, `Retry-After` and `Cache-Control: no-store`. The retry hint is Project policy, not a promised maintenance end time. `operationModeRejectionAuditFields` emits only fixed reason/context; it does not publish operator metadata or internal diagnostics.

The primitive does not default-wire itself into the Worker or exempt routes. Projects must choose the protected routes and an explicit control-plane path so authorized operators can exit maintenance; that path still requires its own authentication, authorization, CSRF and Audit. Health/static route availability is also a Project decision. GET / HEAD / OPTIONS routes must not perform business mutations. Method classification does not replace per-operation semantics, auth or concurrency checks.

### Validation

Unit and Request/Response boundary tests cover the mode/method matrix, fresh state reads, fail-closed errors, environment mismatch, response correlation, retry mapping, safe Audit projection and rejection before the protected handler executes. Existing protected APIs continue to run in required CI; Guard adoption is explicitly outside this Issue.
