# Runtime Integrity

## Purpose

This Full-stack Template turns the technology-independent Runtime Integrity guidance from the upstream Generic Template into an executable D1 pattern.

The example deliberately uses the neutral `example_resources` model. Projects should replace the example domain language while preserving the integrity boundaries that apply to their own shared state.

## Integrity model

```text
Client reads Resource(version = N)
        ↓
Mutation sends expectedVersion = N
        ↓
Trusted persistence boundary
  ├─ verifies version
  ├─ verifies mutable state
  ├─ verifies allowed transition
  └─ writes resource + change record atomically
        ↓
version = N + 1
```

A stale client must never silently overwrite a newer value.

## Example resource state

`example_resources` has these states:

```text
draft -> active -> finalized
```

Rules:

- `draft -> active` is allowed
- `active -> finalized` is allowed
- reverse transitions are rejected
- skipping directly from `draft -> finalized` is rejected
- `finalized` is terminal and immutable

The transition rule is implemented as pure domain logic in `src/domain/example-resource.ts` so it can be tested without D1 or HTTP.

## Optimistic concurrency

Each example resource has:

```text
version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
```

Mutations use the current version in the SQL predicate:

```text
UPDATE ...
WHERE id = ?
  AND version = ?
```

On success the same statement increments the version.

If no row is updated, the store reloads the resource and classifies the result as one of:

- `not_found`
- `stale`
- `immutable`
- `state_changed`

The caller therefore does not treat a zero-row update as success.

## Atomic multi-write

A successful mutation changes two logical records:

1. `example_resources`
2. `example_resource_changes`

Both prepared statements are passed to one D1 `batch()` call. The change record is conditional on observing the next resource version created by the update.

```text
D1 batch
  ├─ UPDATE example_resources ... version = version + 1
  └─ INSERT example_resource_changes ...
```

This is the template pattern for mutations that must not expose partial success across multiple writes.

Projects should not split such writes across independent requests merely because each individual statement succeeds in isolation.

## Database invariants

The database also rejects structurally invalid state:

- resource status is limited to `draft | active | finalized`
- resource version must be at least 1
- change kind is limited to known example change types
- status-transition change records require valid from/to states
- each resource version has at most one change record
- change records reference an existing resource

Application checks improve error handling, but database constraints remain the last integrity boundary for invariants that can be represented in SQL.

## Failure behavior

Runtime Integrity is fail-closed:

- stale mutation: no success response from the store
- terminal resource: mutation rejected
- invalid transition: rejected before D1 mutation
- inconsistent batch outcome: treated as an integrity error rather than accepted as partial success

A later Boundary Tests issue will map these results to concrete HTTP behavior and assert that rejected operations leave persisted data unchanged.

## Scope boundary

This layer does not decide:

- who the user is
- whether the user is authorized
- HTTP status codes
- product-specific state machines
- audit/correlation logging
- delete semantics

Those responsibilities belong to Authentication, Authorization, API boundary, product domain, and Audit layers respectively.

## Testing

Unit tests cover:

- allowed and rejected state transitions
- terminal-state detection
- D1 batch composition
- version predicate presence
- stale mutation classification
- terminal mutation rejection
- state-change rejection
- inconsistent batch outcome detection

CI also applies all migrations to Local D1 and verifies the new table and `status` / `version` columns. Remote D1 is not used.
