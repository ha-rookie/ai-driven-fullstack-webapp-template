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

### Human Gate preparation: exact scope and sequencing

**No item below authorizes remote execution.** The operator approves each separate change before execution. Keep Cloudflare Workers on **Free**. The approved identity mapping must use a verified Google `sub`, not an email address. Do not paste secrets, authorization codes, ID tokens, transaction cookies or D1 credentials into Issue comments, CI logs, Notion, screenshots or PRs.

1. **Read-only preflight (no approval required):** confirm the deployed Preview Worker name/origin, `wrangler.jsonc` Preview binding, main SHA, #521 status, current Preview authentication mode, public `/showcase` reachability, and availability of a rollback deploy. Existing `wrangler.jsonc` currently has `RUNTIME_ENVIRONMENT=preview` and `WORKHUB_DEMO_MODE=true`; it does **not** select `WORKHUB_FREE_AUTH_MODE=google_oidc`. Do not mistake merged code for activation. Record each observation as *observed*, *not observed*, or *requires approval*; do not infer a Cloudflare dashboard setting from source control.
2. **Google OAuth client — separate approval:** identify the Google Cloud project owner, confirm the intended OAuth consent audience and any testing-user restrictions, and obtain approval before creating/modifying a **Web application** OAuth client. Its **authorized redirect URI** must include exactly `https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev/api/auth/oidc/callback`. Do not whitelist wildcard origins, Production callbacks, or unrelated JavaScript origins. Do not assume a new Google Cloud project, billing account or consent publishing is free/authorized merely because Workers remains Free.
3. **Identity enrollment — separate approval:** choose **one existing active, non-admin WORKHUB account** for the initial smoke. The operator must establish the intended Google account's `sub` from a cryptographically **verified** Google OIDC ID token with the expected issuer/audience, using an approved restricted enrollment procedure; **email alone does not determine `sub`**. PR #603 deliberately does not expose the verified `sub` on the unlinked callback, so there is currently **no automated bootstrap/enrollment UX**. If the trusted subject cannot be obtained, **stop**; do not fabricate one, decode an unverified JWT as proof, dump tokens to logs, or enable email-based auto-linking. Before the approved Preview D1 mutation, review the exact `provider=google, provider_subject=sub, user_id` association, uniqueness constraints and the account's actual role. Back up/record a minimal rollback plan without exporting private data into a public artifact. One Google subject must not be linked to multiple Demo personas.
4. **Preview-only secrets and config — separate approval:** register `GOOGLE_OIDC_CLIENT_SECRET` and `WORKHUB_OIDC_TRANSACTION_KEY` (fresh 32 cryptographic random bytes encoded as **43-character unpadded base64url**) as Preview-only secrets. Configure `GOOGLE_OIDC_CLIENT_ID` and `WORKHUB_FREE_AUTH_MODE=google_oidc` **for Preview only**. Ensure the binding is not propagated to Production. Each remote secret, variable or resource change is a Human Gate; never include actual values in git, diagnostics or the PR. Confirm target Worker and preview environment before writes.
5. **Deploy / cutover — separate approval:** only after the OAuth client, approved identity binding and secrets/config are ready, deploy the intended immutable main SHA to **Preview** and record the actual deployed SHA/result. In OIDC mode the old `POST /api/auth/login` is intentionally blocked; switching the flag **before** usable credentials and mapping will lock out WORKHUB users. Public Showcase must remain accessible.

### Live acceptance, cost check and fail-safe rollback

Run only after the corresponding Human Gates. Do not claim that PR #603's mocked CI exercises Google's live authorization or that prior password-persona browser tests validate OIDC.

- **Unauthenticated/public:** `/showcase` remains publicly accessible; `/api/workhub/demo-config` reports selected auth mode without exposing secrets; legacy POST login is rejected without falling back to scrypt; missing OIDC configuration fails closed.
- **Approved identity:** the explicitly linked Google account can log in with a fresh browser, obtain `/api/auth/me`, access **only** its pre-existing authorized WORKHUB functions, log out, and fail `/api/auth/me` with the revoked session. Repeat on desktop/mobile. Record no-retry response/status and sanitized request/CF-Ray metadata without tokens or cookies.
- **Denied identity:** unlinked/disabled accounts cannot receive an application session; state mismatch/expired transaction/cookie tampering fails closed. If a safe real test is unavailable, retain the mocked unit-test result as *local only*, not live evidence.
- **Cross-role:** Aoi, Ren, Kai and other demo personas **cannot** be tested as different roles using one linked Google identity. Testing additional roles requires separate verified Google subjects and separately approved mappings (or a later explicitly reviewed test mechanism). Mark unavailable roles **not tested** rather than successful.
- **Free-tier reliability:** verify the real Cloudflare subscription/CPU limit using account evidence, confirm requests no longer execute scrypt, then measure actual Preview Google-login samples with **zero retries**, CPU/resource-outcome telemetry and HTTP 503 counts. Record the sample size, timestamps, deployed SHA, Worker name, known observability limitations and the result of each check. Do not infer a full cure from 0/12 or from a successful CI run.
- **Rollback / stop:** stop cutover on wrong client/audience, unexpected role, unlinked identity, repeated login failure, resource-limit events, unavailable audit evidence or public Showcase regression. Restore the last explicitly approved Preview configuration/deployment with separate approval as required; revoke/rotate affected Preview-only credentials if exposure is suspected. Restoring legacy password mode may reintroduce the original scrypt/503 problem: it is **availability rollback, not #521 remediation**. Do not touch Production or bypass approval.
- **Close criteria:** do not close #521 or change the #521 Focus policy until real Google sign-in, logout/revocation, authorization, public accessibility, Free-tier resource outcome and repeatable no-retry Preview evidence satisfy the issue acceptance. Any incomplete role or metrics evidence remains explicitly open.

Official Google references:
- https://developers.google.com/identity/openid-connect/openid-connect
- https://developers.google.com/identity/openid-connect/reference

Official documentation:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://developers.cloudflare.com/workers/configuration/cloudflare-access/

### UI authentication-mode discovery failure policy (#521)

WORKHUB's login page must treat `GET /api/workhub/demo-config` as the authoritative authentication-mode discovery response. While it is pending, when it fails (network, non-2xx, invalid JSON), or when it reports an unsupported/malformed mode, **do not render either credential entry form or Google sign-in action**. Display a non-sensitive configuration-availability message instead; the public Showcase link stays available. A valid default/local mode may show the pre-existing password form; only an explicit `google_oidc` mode can show Google sign-in, and only when `oidcEnabled === true`. This UI protection is additional to the Worker-side 409 no-fallback guard; it does not replace server-side enforcement, weaken credentials or activate Preview OAuth.

Local E2E should cover a delayed response, HTTP 503, malformed mode/JSON, valid OIDC enabled/disabled, and unchanged normal legacy login. These are mocked browser checks, **not** evidence of live Google OAuth or Preview CPU recovery.
