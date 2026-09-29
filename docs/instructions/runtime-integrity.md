# Runtime Integrity Scoped Instruction

## Applies When

Use this Instruction for optimistic concurrency, state transition, atomic multi-write, invariant enforcement, stale update/delete/finalize, or conflict handling.

## Scope Hints

- `version` / expected-version handling
- state machines and terminal states
- D1 mutation stores
- multi-write mutation batches
- conflict/stale-result mapping
- mutation endpoints and related tests

## Sources to Read

- `../RUNTIME_INTEGRITY.md`
- `../DATA_DESIGN.md`
- `../BOUNDARY_TESTING.md`
- applicable Common Template testing / security Instructions

## Rules

- Carry the version/concurrency token observed by the caller through to the mutation boundary; do not silently reacquire a fresh token just before update
- Reject stale mutations rather than accepting last-write-wins as the default
- Keep state-transition rules in testable domain logic and enforce representable invariants again at the trusted persistence boundary
- Increment resource version only on successful mutation
- When multiple writes form one logical mutation, keep them within one atomic/conditional persistence boundary
- Classify zero-row/failed conditional updates explicitly (`not_found`, `stale`, immutable/state-changed, etc.) rather than treating them as success
- If child mutation affects parent aggregate validity/version, make the propagation rule explicit
- Preserve conflict information so the API/UI can reload or ask the user to retry instead of pretending success

## Do Not

- Do not reacquire `expectedVersion` after a read→human-action→mutation flow just to make a stale write pass
- Do not split logically atomic writes into independent requests without an explicit compensation design
- Do not rely on Frontend checks as the last integrity boundary
- Do not remove database constraints merely because equivalent application validation exists
- Do not return success when persistence reports zero affected rows or an inconsistent multi-write result
- Do not auto-merge conflicting user edits unless a Product-specific merge rule exists

## Validation / Evidence

- allowed transition/mutation succeeds and increments version exactly once
- stale update/delete/finalize is rejected with persisted state unchanged
- invalid/terminal transition is rejected before harmful write
- concurrent mutation test proves no silent overwrite
- multi-write failure does not leave partial business state
- database constraints reject structurally invalid state where applicable
- boundary tests verify conflict mapping and no partial mutation after rejection
