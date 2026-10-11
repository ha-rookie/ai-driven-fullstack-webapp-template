# Preview login HTTP 503 — Cloudflare historical metrics (#521)

## Confirmed incident
Source: [2026-10-08 Browser run #37852647534](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/37852647534) → job #113569197517.

- The sanitized shared-helper login records include **22 HTTP responses**: 19 HTTP 200, 3 HTTP 503.
- Failed retries at 2026-10-08 **22:20:59–22:21:03 UTC** all used **YYZ**:
  - `a4788935de15ccd9-YYZ`
  - `a478893ee99eccd9-YYZ`
  - `a478894c6828ccd9-YYZ`
- The three 503 responses had neither application `x-request-id` nor `x-auth-dependency-stage`. The same run also recorded successful YYZ logins with application request IDs, so location alone is not evidence that YYZ was wholly unavailable.
- Another distinct HTTP 503 path stalled when an older test attempted to read response text; later test fixes removed this unrelated Playwright response-body assumption.
- Two newer strict no-retry Preview Auth-only runs [#38119657425](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38119657425) and [#38119675335](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38119675335) saw 12/12 successful fresh logins, 0 retries, and usable request ID and CF-Ray on each.

## Runtime attribution boundary
Cloudflare documents that Worker CPU/memory limits can lead to 503, while Cloudflare datacenter routing problems can also lead to 503. Missing application headers indicate an *unattributed* response; they do **not** uniquely identify a datacenter outage or exonerate the Worker. Do not weaken password scrypt configuration, security checks, authorization or limits on that basis.

`wrangler.jsonc` has no explicit Preview `observability.enabled`. Workers Logs would require an explicit settings change and redeploy if not already enabled on the deployed Worker, and retention is account-plan-dependent (Workers Free 3 days, Paid 7 days, max 7 days). Cloudflare Workers invocation metrics are a **different** dataset with longer availability, and are suitable for aggregate incident-time triage, not historical individual-Ray tracing.

## Read-only incident metrics flow
1. Owner issues `/diagnose-preview-auth` as a **standalone comment** on [Roadmap #132](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/132).
2. Existing owner-only GitHub Preview operations gateway dispatches `.github/workflows/preview-auth-metrics.yml` on main. This manual workflow has `contents: read` and `environment: preview`. It does not deploy, mutate D1, seed data, change Cloudflare configuration, or create resources.
3. `scripts/preview-auth-metrics.mjs --self-test` checks parser and safety limits; `--query` requests only Cloudflare GraphQL `workersInvocationsAdaptive` for the **immutable** Preview Worker name and 2026-10-08 22:20:50–22:21:12 UTC. It prints only sampled Worker counts, error counts, status classes, max reported CPU p99, and metadata limitations.
4. Existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are sourced via the GitHub Preview Environment; no new secrets or scope changes are permitted. If the token lacks Analytics Read, **fail safely** and keep #521 blocked on existing-account telemetry access. Never elevate/reuse unrelated migration credentials to work around failure.
5. Compare `exceededResources`, `internalError`, and `exception` aggregate statuses at the incident time. Absence of matching rows, or even presence of aggregate errors, cannot attribute a particular Ray ID. If detailed Workers Logs / Log Explorer are available, use Ray-specific search; record retention and available sampling instead of asserting missing=healthy.

**Safety:** Do not log Cloudflare token/account ID, cookies, client IPs, request URLs, exception stack traces, raw GraphQL error body, personal data, or the login response body. The script has a 12-second network deadline, 100-row maximum, fixed account-scoped query and no write API. CLI and YAML are subject to existing repository CI.

## Completion conditions
- Historical per-Ray origin remains *unverified* until Cloudflare traces/logs identify the request and its Worker/edge path.
- Do not mark #521 closed merely because bounded newer logins succeed or the GraphQL aggregate shows zero errors.
- Remote Cloudflare configuration, new Analytics credential, secret change, Production change, D1 migration, new logging binding, or broader environment setting is a separate Human Gate.
- Other backlog issues retain their #132 priority; recording an observed control gap does not automatically make it the next focus.

## External official references
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- https://developers.cloudflare.com/workers/observability/metrics-and-analytics/
- https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
- https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-503/

## Free Workers resolution path: Google OIDC / external ID verification (2026-10-11)

**User decision: Workers Free only; no paid plan or weakened password hashing.**

Free Workers allow 10 ms of CPU per HTTP request. The current scrypt verification (N=32768, r=8, p=3) uses well over that in local profiling. Simply reducing hash factors, switching to SHA-256, treating a public demo password as an authentication bypass, or retrying 503 responses is not permitted.

This project already provides a security-tested Google OIDC adapter with authorization-code/PKCE, state/nonce, issuer/audience/JWKS signature validation and a D1 table for pre-linked external identities. The preview-only WORKHUB OIDC HTTP integration reuses these foundations.

### Behavior without external configuration

The default local WORKHUB mode is unchanged. Setting `WORKHUB_FREE_AUTH_MODE=google_oidc` only in the Preview environment:

- Blocks `POST /api/auth/login` with a non-success response instead of executing scrypt
- Shows a Google sign-in action instead of the password form
- Exposes `GET /api/auth/oidc/start` and `GET /api/auth/oidc/callback` only on the exact Preview HTTPS origin
- **Fails closed** if Google OIDC or the encrypted transaction key is missing
- Issues the existing opaque `app_session` only after Google ID-token verification and lookup of a **pre-linked, active** `provider=google + subject` in `external_identities`
- Never creates a new user automatically, maps identity by mutable email or permits unrestricted persona impersonation
- Stores short-lived OIDC state, nonce and PKCE verifier encrypted in a 5-minute AES-GCM Secure/HttpOnly/SameSite=Lax transaction cookie
- Leaves production and the original reference ID/password plus secure scrypt implementation intact

### Remote activation requires a separate Human Gate

This PR intentionally does **not** create or change Google Cloud OAuth clients, Cloudflare resources, D1 identity mappings, Secrets, Production settings or Preview environment variables.

After explicit approval, activation needs:

1. A Google OAuth Web Application client allowing exactly `https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev/api/auth/oidc/callback` as a redirect URI; verify whether Google's client- and provider-side quotas/terms suit the free reference use case
2. `GOOGLE_OIDC_CLIENT_ID` (Preview-only variable) and `GOOGLE_OIDC_CLIENT_SECRET` (Preview-only secret)
3. `WORKHUB_OIDC_TRANSACTION_KEY` generated from 32 CSPRNG bytes, stored as a 43-character base64url **Preview-only secret**; rotate with explicit rollback plan
4. `WORKHUB_FREE_AUTH_MODE=google_oidc` set only in Preview and an authorized deployment after (2)+(3)
5. Explicit linking of the chosen Google OIDC `sub` to the approved existing WORKHUB `users.id` in Preview D1 through a separately approved user/identity operation; never auto-link on email and never assume the demo personas are trustworthy human identities
6. Verify sign-in, `/api/auth/me`, authorization, logout/session revocation and missing/disabled/unlinked accounts; ensure CPU stays within Free limits and browser reliability tests run with zero scrypt credential-verification attempts

The current Preview demo selector has multiple roles. A single linked Google account may not silently impersonate all of them. Multi-persona Preview testing requires explicit role-specific provider bindings or a **separately reviewed and auditable** Preview test-role mechanism. Existing account-switch test automation based on the public demo credential is **not** evidence for the new OIDC mode; update the acceptance process when the mode is activated.

**Issue #521 remains open until remote setup, read-only capacity telemetry, strict Browser acceptance and incident mitigation evidence are complete.** The public Showcase must remain accessible if authentication routes or future Access policies are changed.

Official documentation:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
