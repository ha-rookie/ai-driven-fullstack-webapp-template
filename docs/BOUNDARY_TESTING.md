# Protected Boundary Testing

## Purpose

This Full-stack Template turns the upstream Generic Template's high-risk boundary-testing guidance into an executable HTTP + Local D1 pattern.

The goal is not only to check response codes. Rejected requests must also prove that persisted state did not change.

## Boundary flow

```text
HTTP Request
   ↓
Authentication
   ↓
Resource Scope lookup
   ↓
Authorization
   ↓
Input Validation
   ↓
Runtime Integrity Store
   ↓
Audit
   ↓
HTTP Response
```

Each layer owns a different decision. UI validation is never treated as a substitute for this trusted boundary.

## Example protected API

The neutral example resource is exposed through:

```text
GET   /api/scopes/:scopeId/example-resources/:resourceId
PATCH /api/scopes/:scopeId/example-resources/:resourceId
POST  /api/scopes/:scopeId/example-resources/:resourceId/status
```

The sample role policy exists only in this Example API:

```text
viewer -> read
editor -> read + write
```

Projects should replace those role names and actions with their own vocabulary. They are not Template-core roles.

## HTTP mapping

| Boundary result | HTTP | Error code |
| --- | ---: | --- |
| no valid session | 401 | `authentication_required` |
| membership / role / scope denied | 403 | `forbidden` |
| invalid request body | 400 | `invalid_request` |
| resource missing / unscoped | 404 | `resource_not_found` |
| stale optimistic-concurrency version | 409 | `stale_update` |
| terminal resource | 409 | `resource_immutable` |
| trusted state changed | 409 | `state_changed` |
| disallowed state transition | 409 | `invalid_transition` |
| dependency failure | 503 | `*_unavailable` |

Authorization denial details remain in the Audit record. The API response stays generic instead of exposing policy internals.

## Scope binding

Issue #17 adds a one-to-one bridge:

```text
example_resources
       ↓ 1:1
example_resource_scope_bindings
       ↓
resource_scopes
```

This migration does not rewrite older migrations or silently assign old example resources to a scope. An unbound resource is not visible through the protected Example API.

A real project may choose to put `scope_id` directly on its domain resource when that is the natural data model.

## Negative-path contract

The Local D1 boundary fixture verifies these cases in order:

1. unauthenticated write -> reject
2. viewer write -> reject
3. editor in another scope -> reject
4. invalid input -> reject
5. editor rename -> success
6. stale rename -> reject
7. invalid state transition -> reject
8. `draft -> active` -> success
9. `active -> finalized` -> success
10. mutation after finalized -> reject

After every rejection, a permitted GET reloads the resource from D1 and asserts the expected name, status, and version.

At the end, CI directly checks `example_resource_changes` and requires exactly three change records: one rename and two valid state transitions. This detects partial writes or hidden changes that a status-code-only test would miss.

## Audit evidence

The same runtime smoke verifies structured events for:

- authorization `role_required`
- authorization `resource_scope_mismatch`
- mutation `invalid_request`
- mutation `stale`
- mutation `invalid_transition`
- mutation `immutable`
- successful rename
- successful state transition

Audit records contain identifiers and bounded reasons, not raw Cookie/token/request-body data.

## Local-first execution

Boundary tests use only Local D1:

```text
migrations
  ↓
Local D1
  ↓
protected-boundary fixture
  ↓
Vite + Worker local runtime
  ↓
curl HTTP boundary scenarios
```

No Preview or Production database is touched. This keeps CI deterministic and avoids consuming remote D1 quotas.

## What projects should preserve

When replacing `example_resources`, preserve the test shape rather than the sample business words:

- positive path
- unauthenticated reject
- authorization reject
- cross-scope reject
- invalid-input reject
- stale/concurrent reject
- terminal/state-transition reject where applicable
- data unchanged after reject
- multi-write completeness after success
- Audit evidence for important failures and mutations

The exact HTTP routes, roles, resource model, and state machine remain project decisions.
