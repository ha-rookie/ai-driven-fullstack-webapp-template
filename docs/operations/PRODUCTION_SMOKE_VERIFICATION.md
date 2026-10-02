# Production Smoke Verification

## Purpose

Confirm that a deployed Production application is alive, ready, and still enforcing a representative authentication boundary without creating or mutating Production business data.

## Standard checks

The default smoke sequence is intentionally small and read-only:

1. `GET /`
2. `GET /api/health/live`
3. `GET /api/health/ready`
4. `GET /api/auth/me` without credentials and expect `401`
5. Optionally, when `PRODUCTION_SMOKE_SESSION_COOKIE` exists in the protected GitHub Environment, call `GET /api/auth/me` with that cookie and expect an authenticated response

The authenticated check is optional because a reusable Production smoke account/session is a Project/Organization responsibility. The cookie value is never written to logs or Evidence.

## Safety contract

- Smoke uses GET only
- No Production test rows are created
- No cleanup job is required because no mutation is performed
- No D1 migration, restore, reset, reseed, deploy, or rollback is executed
- Base URL must be a canonical HTTPS origin
- Timeout, retry count, response-size limit, and checks are bounded by `config/production-smoke-policy.json`
- Response bodies are used only for bounded assertions and are not persisted
- Failure is a Release Stop Condition; this workflow does not automatically roll back

## Evidence

The Evidence JSON records only:

- environment (`production`)
- deployed commit SHA
- Production origin
- whether the optional authenticated check ran
- check ID, pass/fail status, HTTP status, bounded failure reason, attempts, and duration

It does not record response bodies, headers, cookies, session tokens, database details, or secrets.

## Execution

Use the manual `Production smoke verification` workflow after a code deploy and, when applicable, after Production migration/schema verification.

Inputs:

- `base_url`: canonical Production HTTPS origin
- `deployed_sha`: exact 40-character deployed commit SHA

The workflow uses the protected `production` GitHub Environment. Configure required reviewers there when Project policy requires an additional Human Gate.

## Relationship to other controls

- #102 defines liveness/readiness semantics
- #106 deploys Production code but does not run smoke implicitly
- #108 handles Production D1 migration separately
- #109 verifies Production schema separately
- #111 owns rollback/stable-marker behavior
- Smoke failure provides evidence for a rollback decision but never performs rollback automatically
