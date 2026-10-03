# Recipe: Runtime Integrity

## Inputs
- mutation and state transition being changed
- current persisted version / concurrency model
- invariants that must hold before and after mutation
- atomic write boundary
- conflict behavior shown to the caller

Read `../RUNTIME_INTEGRITY.md` and `../instructions/runtime-integrity.md` first.

## Stop Conditions
Stop when:
- the authoritative version field is unclear
- multiple writes must succeed together but transaction/atomicity is undefined
- conflict handling would silently overwrite newer data
- retry semantics could repeat a mutation without idempotency protection
- a destructive transition has no explicit invariant or owner

## Steps
1. Write the invariant and allowed state transition before changing persistence code
2. Include the expected version or equivalent precondition in the write condition
3. Return a conflict result instead of overwriting newer persisted state
4. Keep related writes inside the defined atomic boundary
5. Preserve idempotency semantics when clients may retry
6. Map conflicts to the shared API error contract
7. Ensure the frontend preserves the user's draft and does not auto-merge or auto-replay mutations

## Validation
- unit tests for allowed and rejected state transitions
- concurrent update / stale-version tests
- idempotency concurrency tests when retry/replay is relevant
- `npm run validate:local`
- Browser evidence for draft preservation when UI behavior changes

## Evidence
Record:
- invariant and transition rule
- expected version / precondition used
- conflict mapping
- atomicity boundary
- concurrency test result

## Do Not
- use last-write-wins for business state without an explicit Project decision
- retry a failed mutation automatically after reauthentication
- merge conflicting drafts implicitly
- split one business invariant across independent commits without a compensating design
- weaken DB constraints to make an application test pass
