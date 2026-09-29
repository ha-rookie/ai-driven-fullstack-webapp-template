# Authorization / Resource Scope Scoped Instruction

## Applies When

Use this Instruction for protected API authorization, membership lookup, role policy, resource-scope checks, or privileged access boundaries.

## Scope Hints

- `resource_scopes`, `scope_memberships`
- authorization policy / guard
- protected endpoints
- admin or cross-scope operations
- role/membership mutation

## Sources to Read

- `../AUTHORIZATION_DESIGN.md`
- `../AUTH_DESIGN.md`
- `../BOUNDARY_TESTING.md`
- `../AUDIT_OBSERVABILITY.md` when denial/privileged-operation evidence changes
- applicable Common Template security / testing Instructions

## Rules

- Authentication success does not imply authorization success
- Evaluate actor identity, membership/role, requested operation, and target resource scope explicitly
- Deny by default when membership, policy, or scope relation is missing or ambiguous
- Verify both caller membership in the requested scope and target resource ownership/scope relation
- Keep role vocabulary and action→role policy configurable by the Project; the Template must not hard-code Product roles
- Keep HTTP/UI mapping separate from pure authorization policy
- Re-authorize on the server for every protected operation, including direct API calls
- Treat role/membership/cross-scope changes as privileged mutations that may require stronger audit and concurrency protection

## Do Not

- Do not introduce a hidden global super-admin bypass as a convenience path
- Do not rely on UI hiding, route guards, or disabled buttons as the authorization boundary
- Do not infer authorization solely from a role string without validating resource scope
- Do not leak resource existence across scope boundaries through overly detailed denial responses
- Do not mix provider identity claims directly into resource authorization policy without mapping to application context
- Do not copy example role names into Project requirements

## Validation / Evidence

- allowed in-scope membership succeeds
- missing membership, insufficient role, and scope mismatch fail closed
- direct API requests cannot bypass Frontend guards
- cross-scope access is rejected unless explicitly allowed by Project policy
- privileged membership/role changes preserve before/after context when required
- rejected operations produce no partial business mutation
- unit/pure policy and boundary tests remain green
