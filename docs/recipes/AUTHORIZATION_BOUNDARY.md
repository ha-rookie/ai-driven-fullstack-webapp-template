# Recipe: Authorization Boundary

## Inputs
- protected resource type and resource scope
- actors / memberships
- Project-defined Role Policy
- read / mutation permission expectations
- deny behavior and audit requirement

Read `../AUTHORIZATION_DESIGN.md` and `../instructions/authorization-resource-scope.md` first.

## Stop Conditions
Stop when:
- resource scope is undefined
- permission is described only by UI visibility
- role names exist but their allowed actions are not defined
- cross-scope access behavior is ambiguous
- privileged operation ownership is undecided

## Steps
1. Define the resource scope before defining role checks
2. Resolve membership / actor relationship on the server boundary
3. Evaluate Project-defined Role Policy with deny-by-default semantics
4. Keep frontend permission guards as UX only; server authorization remains authoritative
5. Add negative-path tests for no membership, wrong scope, disabled user and insufficient permission
6. Add Audit evidence for privileged or accountability-sensitive actions when required
7. Update Browser behavior only after server semantics are fixed

## Validation
- authorization unit tests
- protected boundary integration tests
- negative HTTP paths including 401 / 403
- `npm run validate:local`

## Evidence
Record:
- resource scope definition
- Project Role Policy source
- server guard location
- negative-path coverage
- Audit event decision

## Do Not
- authorize by hiding a button
- reuse Example `viewer` / `editor` names as Product requirements without an explicit Project decision
- infer access from a user ID alone when resource membership is required
- default unknown permission to allow
- mix authentication failure and authorization denial semantics
