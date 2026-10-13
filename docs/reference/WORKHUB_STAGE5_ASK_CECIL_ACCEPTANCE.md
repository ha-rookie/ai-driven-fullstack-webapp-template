# WORKHUB Stage5 Ask CECIL — development acceptance (Issue #349)

Date: 2026-10-13  
Baseline: [WBS #343](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/343), [Roadmap #132](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/132).  
Target: **Stage5 Reference functional-development acceptance**, not formal consolidated System Test or commercial HR/Support product acceptance.

## Safety Matrix implementation / evidence

| #343 safety requirement | Development verdict | Demonstrable behavior and evidence |
|---|---|---|
| L0 Answer from authorized, current source | **Pass** | Current `/api/workhub/search` ∩ current `/api/workhub/documents` only. Source-authored text, title, category, version, owner and reviewedAt; never synthesize unverified policy. [PR #662](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/662) and `tests/ask-cecil-evidence.test.ts`. |
| L1 Find / Navigate | **Pass** | Current search access restrictions, local `#workhub-*` links only, no arbitrary URL. Search error distinguished from zero matches. [PR #662](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/662). |
| No answer from insufficient/stale/possibly conflicting sources | **Pass (conservative)** | Insufficient/old/stale/multiple current documents do not produce a composite authoritative answer. The system identifies possible conflict; it **does not perform semantic document-contradiction detection**. `tests/ask-cecil-evidence.test.ts`. |
| L2 Prepare / Draft | **Pass** | Authorized application + current office master; user enters all fields explicitly. Values stay in client state and are handed to actual TravelRequest form without saving, modifying or submitting a request. `tests/ask-cecil-travel-draft.test.ts`; [PR #663](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/663). |
| L3 Confirmed Action | **Pass** | Existing TravelRequest form presents human actor, target/fields, create-and-submit and manager approval consequence. Explicit second confirmation only then invokes existing server-validated Application Service; cancellations/edits/stale auth do not write. Snapshot and browser tests; [PR #664](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/664). |
| L4 privileged approval | **Pass as safety boundary** | Ask CECIL does **not** provide AI-driven Approve / Return / Role changes. Existing separate, assigned-human WORKHUB approval service remains authoritative. No autonomous L4 capability is claimed. |
| L5 forbidden autonomous actions | **Pass as restriction** | No AI-run deployment, privilege escalation, destructive delete, production/secret change or automatic Business approval is implemented. |
| Escalate when evidence is incomplete/conflicting or search unavailable | **Pass for Reference manual handoff** | User can prepare an explicit inquiry note, only with source metadata whose authorization + version still match a fresh documents GET; revoke/unavailable -> question only; navigate to existing People directory and choose human inquiry route. **No automatic transmission or actual support-ticket creation.** [PR #665](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/665), `tests/ask-cecil-escalation.test.ts`. |
| Business state/audit distinct from conversation | **Pass for current Reference** | Ask CECIL query/inquiry preparation does not write domain/audit/chat DB. Confirmed human submits through existing TravelRequest/Workflow/Timeline. **AI-assisted actor attribution for a future actual agent backend is not implemented**; current interaction uses a deterministic Reference interface, not a deployed autonomous LLM agent. |
| Desktop/mobile/keyboard | **Automated checks passed; formal ST deferred** | Desktop side panel, 390px mobile full view, Escape/focus restored, supported keyboard/accessible controls covered by browser E2E. Actual Android/iOS physical devices and OS screen readers remain **NOT RUN**, to be assessed in consolidated System Test per project test strategy. |

## Final development validation

- [PR #662 L0/L1](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/662): Full-stack CI + Browser E2E + Secret succeeded; Preview deployed; HTTP smoke succeeded.
- [PR #663 L2](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/663): Full-stack [#38338610146](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38338610146), Browser [#38338610181](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38338610181), Secret [#38338610145](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38338610145) SUCCESS.
- [PR #664 L3](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/664): Full-stack [#38344755671](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38344755671), Browser [#38344695812](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38344695812), Secret [#38344695836](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38344695836) SUCCESS.
- [PR #665 Escalation](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/pull/665): Full-stack [#38347133854](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38347133854), Browser [#38347133890](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38347133890), Secret [#38347134032](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38347134032) SUCCESS.
- Last app code main: `74f84c0582ec50fed27f2ffcf554367a41c5b159`. Owner-gated [Preview deploy #38347498189](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38347498189) preflight/deploy SUCCESS; [read-only HTTP Smoke #38347621571](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/38347621571) SUCCESS.

**Do not confuse evidence:** automated Browser E2E runs against the local test environment. Preview Smoke checks HTTP only; it is **not** authenticated live Preview business system testing. Physical Android/iOS, TalkBack/VoiceOver and authenticated full workflow are deferred to consolidated System Test, **NOT RUN**. This status must remain visible in the tracking system.

## Boundaries and next WBS step

- Actual helpdesk tickets/emails/dispatch/ownership of inquiries are **not implemented** in Ask CECIL. Existing #294 Support/Help is optional in #343, not a prerequisite to Stage5 Reference manual escalation; do not portray this as a working ticket integration.
- No new Model/LLM tool execution, D1 Migration, Secret, Cloudflare resource or Production deployment was introduced in Stage5.
- Stage5 functional development can be accepted under the Reference scope above; formal System Test remains later. No blanket claim of enterprise-ready operation.
- The preapproved sequence after Stage5 is Stage6 [#351](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/351) Developer Mode / Guide, **only after** a separate approved Work Selection focus transition. Do not update `config/work-selection-policy.json` or change milestones in this acceptance PR.
