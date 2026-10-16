# Stage8 #420 Security Center — first read-only vertical slice

## Business outcome
An authorized WORKHUB administrator can open **Security Center** from the existing Admin Portal, inspect which security-check domains have not been connected, view the registered SCS requirement/responsibility/control/evidence *reference mapping*, filter it, and navigate to the existing Audit Event viewer. No scanner or data import is invented to make the dashboard look complete.

The parent #410 still covers scanner and runtime checks across identity, data, integration, and agent domains; those broader implementations remain OPEN. The #724 pure Finding/coverage contract and the #727 source-kind contract are reused, but **no live source submits actual Findings** at this stage. User-visible "not-checked", unmonitored, unavailable and unknown are not healthy-green, and the absence of a verified count is never 0. The timestamp from the API reflects **this projection request**, not the most recent audit.

## Data sources and boundaries
- Existing `src/shared/security/security-finding.ts` provides strict `normalizeSecuritySourceCoverage`; a never-checked source has `checkedFindingCount: null` and freshness unknown.
- Existing `src/shared/security/security-source-snapshot.ts` supplies the registered source kinds. The read model does **not** forge a completed `SecuritySourceSnapshot`: without authentic CI result evidence there is no run ID, success time, or verified finding count.
- `config/scs-control-mapping.json` is an existing **static, repository-reviewed** technical responsibility mapping. The browser displays its registered requirement IDs, statuses, control, test and evidence references. They are not verified live as-of date, not an externally audited organizational control and not SCS star status / certification. An unregistered test or evidence remains explicitly unregistered, and *freshness* remains unknown.
- The existing `GET /api/admin/audit` is a separate **Audit Event** source with its own scoped policy. A link does not assert that an audit event is a Security Finding or matches a requirement.
- The new `GET /api/admin/security-center?scopeId=workhub-company` rejects unsupported methods, missing/extra/duplicate scopes, foreign scopes, unauthenticated users, unprivileged memberships, and unavailable runtime configuration before producing any status data. It reuses `requireAuthenticatedUser` and `requireScopedAuthorization` (`administration:manage`, `system_admin`), with a single fixed WORKHUB scope and no-store responses. It reads no application D1 records outside the existing authorization/session checks.
- The UI guard is presentation only. All administrative data access must be independently authorized server-side. No permission or provider credential is accepted from the browser.

## Acceptance slice vs original #420 11 conditions
This PR is an **incremental** Stage8 slice (`Refs #420`), not full issue closure. It supplies an initial #724 coverage UI and SCS responsibility/registered reference view, an independently authorized GET boundary and browser/negative tests. No real finding feed is available; therefore severity/category/status filtering over verified Findings, detailed safe Finding evidence, remediation/correlation binding, live source last-success timestamps, and verified Requirement → Evidence → Freshness semantics remain for later separately reviewed #420 PRs. The original 6+5 acceptance checklist is neither rewritten nor automatically checked by a green CI.

## Non-goals and validation
No D1 migration, new scanner, GitHub API, external provider SDK, runtime audit scheduling, production repair, key management, retention manipulation, bulk disclosure, credential transport, SCS certification, automated remediation, deployment, or Cloudflare resource modification.

Validation consists of source/TypeScript diff inspection; contract/authorization unit tests with bad queries, GET-only and missing runtime/session; and browser checks with a real local admin and non-admin session. Browser verification is a local harness test, **not** Preview or Production verification. Formal authenticated business/system acceptance and mobile physical-device testing belong to #694 (Not Run).
