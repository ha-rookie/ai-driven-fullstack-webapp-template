# WORKHUB Error / Empty / Recovery — Representative Scenario (#350)

## Scope and truthfulness

**Scenario ID:** `scenario.workhub.error-recovery`  
**Status:** **Partially implemented Reference** with local unit/browser checks; **NOT** complete end-to-end business System Test and **NOT** Production acceptance.

This is a cross-screen walkthrough of how users recognize failure, distinguish authoritative business state from read projections, and choose the next safe action. The Developer Guide is **static evidence navigation**: it does not trigger failures, grant access, run admin operations, or read business records.

## Representative acceptance matrix

| Case | What the user is told | Authoritative state / safe action | Evidence on main | Remaining |
| --- | --- | --- | --- | --- |
| A. Unknown route / 404 | Page not found with the original office illustration, explanation and safe Home link | Do not disclose internal routes; navigate Home, never POST | [#676](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/676), [#679](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/679); `src/App.tsx` | Formal physical-device/assistive ST |
| B. Another employee's private TravelRequest | Identical hidden 404 for unauthorized and nonexistent ID; never expose title/owner | TravelRequest Service owns authorization; retrying with guessed IDs is not recovery | [#684](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/684); `src/reference/workhub/travel-request/service.ts` | Formal penetration/ST |
| C. Stale approval / 409 | Approval state has changed; no false confirmation | Workflow is authoritative; GET current MY WORK, never auto-replay approval POST | [#681](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/681); `e2e/tests/workhub-approval-recovery.spec.ts` | Formal authenticated Preview ST |
| D. Notification unavailable after approved action | Confirm the business approval succeeded; notification refresh unavailable separately | Workflow decision remains completed; retry only notification **GET** | [#681](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/681); `e2e/tests/workhub-approval-recovery.spec.ts` | Formal authenticated Preview ST |
| E. Search provider unavailable | `0 results` is not displayed for 502/malformed response | Search is projection; clear stale results and re-read original query with GET | [#683](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/683); `e2e/tests/workhub-search-unavailable-recovery.spec.ts` | Formal ST |
| F. MY WORK genuinely empty vs unavailable | Friendly empty copy **only** for confirmed valid empty; failures mean unknown count | Task/workflow source; refresh via GET only, return focus to heading | [#682](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/682); `e2e/tests/workhub-my-work-empty-recovery.spec.ts` | Formal ST |
| G. Report generation failure | In an already-authorized, completed TravelRequest detail, report status is shown separately from the completed Workflow. A failed/missing/unavailable report is **never** represented as a failed approval | Owner authorization precedes the D1 status lookup. Status refresh reads the same GET only; no approval POST, report retry, raw failure code, private storage link, or claim of automatic generation | [PR #690](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/690) merged; `src/worker/workhub-business-api.ts`, `src/reference/workhub/TravelReportRecovery.tsx`, `tests/report-artifact-d1.test.ts`, `e2e/tests/workhub-report-status-recovery.spec.ts` | Actual job dispatch/generation wiring, real persisted failed-artifact browser scenario, file download path, authenticated Preview ST and physical accessibility acceptance |
| H. Maintenance/read-only denial | Actionable mode-specific copy only for **explicit** OperationModeGuard error codes | Server owns mode/authorization; UI blocks repeat changes locally, GET navigation remains | [#685](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/685); `e2e/tests/workhub-operation-mode-recovery.spec.ts` | Validate Worker business-route guard wiring; formal ST |

[PR #686](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/686) already merged the terminal-failure duplicate-job guard. The #350 follow-up connects a **read-only end-user status** to existing TravelRequest detail, but does not schedule a report, execute a report worker, download a file, or prove a persisted workflow/report end-to-end scenario. Those are separate acceptance gaps.

## Severity-aware personality

Personality must not conceal error semantics, primary recovery actions, or actual state.

| Severity | Representative state | Treatment / reason |
| --- | --- | --- |
| High (safe, no mutation) | 404; genuinely empty MY WORK | Original WORKHUB illustration and calm human copy are acceptable because no business mutation is implied |
| Medium | Confirmed search no results | Light microcopy, but leave filter/query recovery obvious |
| Medium–low | Read-only/maintenance | Distinct calm next-action copy, not an unexplained numeric error |
| Low | Stale approval 409; access denied/hidden 404 | Clear conflict/security semantics dominate; do not joke about customer data |
| None | Security incident; uncertain outcome of business mutation | No humor and no blind retry; preserve investigation and operator contact route |

## Recovery invariants

1. UI and projection status do **not** replace backend Authorization, Workflow state or Operation Mode.
2. GET-only read refresh must be visually and functionally distinguishable from mutation retry. An ambiguous POST result cannot be replayed automatically.
3. An approved decision is not reversed by a failed notification or generated report.
4. A malformed success response must not be counted as zero business records.
5. An unauthorized resource's existence and its details must not leak via error labels, status differences or recovery URLs.
6. Status must not depend on color alone; error/recovery actions must be keyboard reachable, with appropriate focus/status announcements.
7. Do not copy stack traces, SQL, secrets, raw provider errors, or business records into the static guide.

## Remaining acceptance and system test boundary

- A read-only report-status/recovery UI is implemented, but full live generated-report flow remains **NOT** implemented/accepted. The UI is informative, not a report generation retry mechanism.
- **Local persisted-failure integration acceptance (new #350 test, pending CI):** `e2e/tests/workhub-report-persisted-failure.spec.ts` exercises real Aoi submit → Ren approve → local D1 `generated_artifacts.status=failed` persistence → Aoi detail GET/390px recovery and protected non-owner GET. It inserts only an isolated local fixture via `wrangler d1 execute DB --local`, with no route interception. This verifies only persisted-failure consumption; it does **not** verify real report job dispatch, R2, actual generated binary download, Preview authenticated ST, or physical-device ST.
- A corrupt/non-canonical persisted report expiry must produce an `unavailable` read-only report projection and a not-found download denial, not a false `ready` state or indefinite file access. Unit evidence: `tests/report-expiry-recovery.test.ts`; the existing report-download core is not yet a WORKHUB user download route.
- The Worker currently calls `OperationModeGuard` before WORKHUB business-route dispatch, but H still needs formal authenticated end-to-end acceptance for each mutation type.
- End-to-end Reference user walkthrough (A–H as applicable), authenticated Preview business scenarios, Android/iOS physical devices, TalkBack/VoiceOver, and cross-device visual/readability are reserved for **consolidated formal System Test**; do not require physical devices in every unit/PR change.
- Production release and remote migration/secret/Cloudflare resource operations remain separate Human Gates. Historical login 503 #521 is monitoring-only until recurrence, and OIDC is not part of #350.

Related: [Issue #350](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/350), [Roadmap #132](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/132), [Developer Guide](WORKHUB_DEVELOPER_GUIDE.md).
