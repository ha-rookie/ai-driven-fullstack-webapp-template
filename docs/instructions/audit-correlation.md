# Audit / Correlation Scoped Instruction

## Applies When

Use this Instruction for request correlation, Audit event contracts, accountability fields, security/authorization/mutation evidence, or Audit sink integration.

## Scope Hints

- `x-request-id` / `CF-Ray` correlation
- Audit event generation / serialization
- authentication, authorization, mutation, system events
- Audit sink / logger integration
- protected endpoint evidence

## Sources to Read

- `../AUDIT_OBSERVABILITY.md`
- `../AUTH_DESIGN.md`, `../AUTHORIZATION_DESIGN.md`, or `../RUNTIME_INTEGRITY.md` when those boundaries are involved
- applicable Common Template security / testing Instructions

## Rules

- Keep Traffic Analytics, Application Log, Audit Log, and Correlation ID as separate contracts even if they later share infrastructure
- Resolve one bounded request ID per API request and propagate it consistently to responses and related evidence
- Project Audit events through an explicit allow-list of fields rather than serializing arbitrary request/domain objects
- Record only the actor/scope/resource identifiers justified for accountability
- Keep Audit categories/outcomes stable enough for downstream search while allowing Product-specific events outside the Template core
- Treat Audit sink failure according to the documented operation class; the baseline best-effort sink must not silently redefine business success/failure semantics
- When a privileged or rejected operation requires evidence, connect it to the shared Audit/correlation contract instead of inventing an endpoint-specific log shape

## Do Not

- Do not place passwords, secrets, raw or hashed session tokens, OAuth codes, Cookie/Authorization headers, or full request/response bodies into Audit
- Do not copy free-form memo/content fields or unnecessary PII into the baseline Audit contract
- Do not trust malformed/oversized client-supplied request IDs or derive correlation IDs from credentials
- Do not expose internal Audit reason detail directly as client error detail
- Do not treat successful read-only traffic as mandatory Audit unless the Project has a justified requirement
- Do not use Audit as a substitute for Application Log, metrics, or analytics

## Validation / Evidence

- request ID is stable across one API request and returned on applicable API responses
- malformed/oversized client request IDs are rejected or replaced safely
- Audit serialization contains only approved fields
- representative authentication/authorization/mutation events preserve expected actor/scope/resource context without secrets
- sink failure behavior matches the documented contract
- tests confirm query/body/header secrets are not accidentally copied into Audit records
