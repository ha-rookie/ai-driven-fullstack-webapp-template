# Recipe: Audit Event

## Inputs
- accountable action or security-sensitive decision
- actor / subject / resource identifiers allowed in Audit
- outcome categories
- correlation requirements
- Project retention / durable storage decision

Read `../AUDIT_OBSERVABILITY.md` and `../instructions/audit-correlation.md` first.

## Stop Conditions
Stop when:
- raw request/response body is being considered as Audit payload
- secrets, tokens, passwords or unrestricted personal data would be recorded
- the actor/resource identifier needed for accountability is unknown
- the Project expects durable retention but storage/retention design is undecided

## Steps
1. Define an event name describing the accountable action, not an implementation detail
2. Record bounded identifiers and decision/outcome fields only
3. Preserve request/correlation ID separately from business identifiers
4. Emit Audit after the authoritative decision point at the correct success/failure boundary
5. Make Audit sink failure behavior explicit; do not silently alter the business transaction contract
6. Add tests for required fields and forbidden/sensitive fields
7. If long-term retention is required, connect to the Project's durable audit decision rather than assuming console logs are sufficient

## Validation
- Audit event unit tests
- protected boundary integration tests
- sensitive-field negative tests
- `npm run validate:local`

## Evidence
Record:
- event name and accountable action
- allowed field list
- correlation behavior
- retention/storage assumption
- representative success/failure test result

## Do Not
- log credentials or raw authorization material
- use unrestricted free-form objects as Audit context
- treat application logs as durable Audit storage by default
- make Audit fields high-cardinality metrics labels
- claim retention guarantees that the configured sink does not provide
