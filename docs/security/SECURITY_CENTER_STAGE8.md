# Stage8 #420 — Security Center, initial read-only vertical slice

## Business result and design choice

An authorized WORKHUB system administrator can view the `Security Center` inside the existing Admin Portal. This is an **initial, read-only status and evidence-reference view**, not the full Security Center acceptance of Issue #420. The user asked that PR #731 and #732 be independently compared and consolidated without merging either PR. PR #732 is the primary implementation because its Worker, **after independent server-side scoped authorization**, projects the existing SCS responsibility/control/test/evidence reference map. PR #731's separate frontend JSON import is not copied: privileged reference data should not be bundled into an unauthenticated frontend artifact merely because the panel is permission-gated.

The Server/Client contract is intentionally bounded to one endpoint and one panel. There is no new child Issue or scanner/Provider integration.

## Exact existing data boundaries

- `GET /api/admin/security/center?scopeId=workhub-company`: single fixed scope, GET-only, reject extra/duplicate query keys, and check runtime environment, authenticated session and `administration:manage` / `system_admin` scope independently of UI navigation. No implicit remote runtime. Auth/authorization/serialization errors fail closed, and successful responses set `Cache-Control: no-store`.
- The existing #724 `normalizeSecuritySourceCoverage` projects four presently unconnected sources into `not-checked`, `unmonitored`, `unknown`, with `checkedFindingCount: null` and without a successful-scan timestamp. These are **not live CI checks** and are **not** actual verified zero findings. #727 defines the more detailed trusted-source observation boundary for later integration. It is not a live provider adapter here.
- The Security Finding feed is **not connected**: `findings.items` and `findings.verifiedCount` are `null`. An unknown count is never reported as `0`; a successful CI run and Audit Event are not converted to Security Findings.
- Existing `config/scs-control-mapping.json` is loaded **inside the Worker**, not in the browser bundle. Its 43 requirements and static Responsibility/Control/Test/Evidence *references* are projected after authorization. The existing mapping's `source.verifiedAt` is **reference-source verification metadata**, not evidence freshness, a current scan, individual requirement compliance, or ★3/★4 SCS certification. Each requirement's evidence freshness is `unknown`; its Finding/Remediation bindings are `null`.
- The UI shows Gray/unassessed/unknown, source health and missing last-success information, plus bounded SCS requirement search. It handles denied/unavailable responses separately and offers a retry. The existing Audit Event viewer remains an independent navigation target; there is no invented Finding-to-Audit correlation.

## Comparison and consolidation record

- Both #731 and #732 had exact-HEAD CI 4/4 SUCCESS before consolidation and both implemented the same #420 feature. In shared paths `src/worker.ts`, `src/reference/admin/AdminPortal.tsx`, `src/worker/administration/security-center-api.ts` and `tests/security-center-api.test.ts`, merging both is not permissible without a scoped re-review.
- Use #732's Worker-side SCS projection, explicit no-assessment/Gray model and requirement-ID/name search as the architectural base. Adopt from #731: strict runtime fail-closed checking via existing resolver, negative tests for unauthorized requests and non-GET methods, a design/acceptance boundary document, and explicit distinction between projection time and verified scan time.
- Keep one endpoint: `/api/admin/security/center`. Do not duplicate #731's `/api/admin/security-center` or second Security Center component. PR #731 is left Open/Unmerged per user authorization, clearly identified as **superseded candidate** pending later explicit PR disposition.

## Verification and unfinished Issue acceptance

Focused API/unit tests cover unknown vs zero, exact query/method checks, missing runtime, anonymous data non-disclosure and timestamp semantics. Local Chromium browser tests cover administrator access, ordinary employee denial, 503 fail-closed UI, and unauthenticated/malformed/unsupported-method access. Existing required validate, secret scan and local smoke check the real repository. The browser CI verifies only local harness behavior, not real Android/iOS devices nor Preview/Production.

Issue #420's **original 11 acceptance items remain unchanged**. Incremental PR results must not be reflected as Closed on main until separately user-approved merge and evidence-by-condition re-assessment. Verified Finding feed, severity/category/status filters, safe per-Finding evidence/remediation, Finding-to-Audit linkage, actual scanner-source last-success, and verified #488 evidence freshness are all incomplete. Parent #410 Tracking remains Open, #430 Failure Safety and #488 evidence semantics remain cross-cutting. Formal System Test #694 is Not Run.

## Operations and approval

This PR must not be merged without an explicit approval of its exact latest HEAD, base/main SHA, passing required CI and review status. No further focus change, Preview/Production deployment, Remote D1/Migration, Secrets or Cloudflare resource mutation is included.
