# Recipe: Auth Provider Adapter

## Inputs
- chosen Identity Provider and protocol
- external subject identifier contract
- user provisioning / linking policy
- session lifetime / revoke expectation
- callback / origin requirements per environment

Read `../AUTH_DESIGN.md` and `../instructions/authentication-session.md` first.

## Stop Conditions
Stop when:
- provider is still undecided
- account linking rules are ambiguous
- provider secret handling is not defined
- callback origin differs across environments but mapping is unknown
- the change would bypass the application session and expose provider token semantics to the rest of the app

## Steps
1. Keep external identity resolution behind a provider adapter
2. Map provider identity to the internal user model
3. Issue the existing opaque application session rather than reusing provider tokens as app sessions
4. Preserve revoke / logout / rotation semantics
5. Add provider-specific callback validation without weakening same-origin / CSRF boundaries
6. Keep provider configuration environment-specific and secrets outside Repository content
7. Add negative-path tests for invalid callback state, unknown identity and revoked user/session behavior

## Validation
- unit tests for provider mapping / callback validation
- existing session rotation and revocation tests
- `npm run validate:local`
- browser/auth integration evidence where the adapter has a Local test double

Remote provider login is separate evidence and may require a Human-triggered environment check.

## Evidence
Record:
- provider/protocol selected by the Project
- external-to-internal identity mapping rule
- secret/config boundary
- Local / CI evidence
- Preview provider evidence when explicitly run

## Do Not
- hard-code one provider into Core session semantics
- persist access tokens unless the Project explicitly requires it and defines encryption/retention
- log provider tokens, authorization codes or raw identity payloads
- treat successful redirect rendering as proof of correct account linking
- silently create users if Project provisioning policy is undecided
