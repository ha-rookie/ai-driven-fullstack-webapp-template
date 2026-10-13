# WORKHUB Stage6 #351 Developer Mode — Development Acceptance & Limits

- Contract: [#351 Final Design Baseline v2](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/351) and the **unchanged** #132 → #343 WBS Stage6
- User-facing: WORKHUB Reference Developer Mode; no debug console or privileged data access
- Architecture/source: `src/reference/workhub/developer-reference.ts`, `developer-guide.ts`, `DeveloperReferencePanel.tsx`, `DeveloperGuideOverview.tsx`
- Baseline prior to final acceptance increment: main `64a2c3a75fe405e69d461bfc1723ccdc50375651`, work focus=[351]
- This is a **development acceptance matrix**, not a formal Preview or physical device System Test report. CI run IDs and final merge SHA are recorded on #351 after actual results.

## What is actually implemented

- Screen-to-Source with stable IDs for HOME, REQUESTS, REQUEST DETAIL, MY WORK, SEARCH, APPS, PEOPLE, DOCUMENTS, NOTIFICATIONS, Ask CECIL, EXPENSES, ANNOUNCEMENTS, SOCIAL and SECONDARY JOURNEY DEMOS
- Screen/Capability/Scenario/Architecture/Adapter cross-reference, source/doc GitHub links to files present in main, Japanese and English readiness text, constraints and safe policy summary
- Reference scenario handoffs: travel-request+human approval+optional separately submitted expense claims, authorized document finding, moving and PC replacement **mock workflows**, conceptual employee onboarding/AI-access only
- Differentiate business Domain/Workflow from read models, static illustrative posts, demo profiles and disconnected external adapters. Source annotations are documentation, not current authorization or business state
- Entry under authenticated user menu (Local and pinned Preview hostname only, default Production disabled), keyboard-dismissable dialog with return focus, no Business API calls from developer panels

## Development acceptance verification (DEV IDs from #351 v2)

| ID | Development evidence | Status / boundary |
|---|---|---|
| DEV-01 HOME | default HOME static reference and source link | Locally automated |
| DEV-02 REQUEST detail | dedicated \`request-detail\` screen ID for \`#workhub-request-detail\`, stable travel scenario, Domain/Workflow/Projection separation and real Source/Docs paths; separate unit/browser assertions | Development assertion implemented; final required CI result recorded on #351 |
| DEV-03 SEARCH | route and metadata for authorization-aware Search | Locally automated |
| DEV-04 Ask CECIL | existing static metadata and human action boundary | Locally automated |
| DEV-05 APPS | app-catalog metadata, disconnected SaaS clearly mock | Locally automated |
| DEV-06 Developer ≠ business entitlement | no API/data change, static public-safe metadata, current business authorization unchanged | Design and local tests; no formal live penetration test |
| DEV-07 metadata failure | pure static registry fallback for unknown IDs; no remote metadata fetch | Local unit; no dynamically failing integration to test |
| DEV-08 Production disabled | exact Preview / local host allowlist, Production/custom host test | Locally automated; hostname check is presentation control only |
| DEV-09 Secret/PII | allowlisted static source/doc paths; no raw business values, no token/SQL logs in panel | Static audit + unit; not a full security audit |
| DEV-10 ja light | local browser locale/theme smoke | Local E2E |
| DEV-11 ja dark | mobile dark local UI and navigation | Local E2E; physical contrast/readability not certified |
| DEV-12 en light | browser locale / guide and stable IDs | Local E2E |
| DEV-13 en dark | local browser locale/theme smoke | Local E2E |
| DEV-14 desktop/mobile/keyboard/OS-reader | local desktop/390px/Escape/focus/navigation; OS accessibility | Partial: actual physical Android/iOS/TalkBack/VoiceOver **NOT RUN**, consolidated formal ST later |

## Source evidence and repeatability

- `tests/workhub-developer-reference.test.ts`: each registered docs/source path must exist on disk, allowlist restrictions, stable IDs, route fallback, role boundary, Reference host only
- `tests/workhub-developer-guide.test.ts`: scenario ↔ screen cross-reference, Capability and Adapter maps derived from registry; concepts/mock explicitly labeled
- `e2e/tests/workhub-developer-reference.spec.ts`: open/close, current screen metadata, mobile/keyboard/focus, no mutation
- `e2e/tests/workhub-developer-guide.spec.ts`: Architecture/Capability/Scenario paths, ja/en locale, no mutation
- `e2e/tests/workhub-developer-catalog-acceptance.spec.ts`: expense/announcement/social/secondary mock routing, source links, user menu and mobile
- Status **before final required CI** is evidence coverage only. Final CI SUCCESS/FAILURE must be appended to #351; do not turn planned verification into a PASS.

## Known operational / product limitations

- WORKHUB uses route/section identity and static reference descriptions rather than a runtime metadata server. The request detail has its own safe metadata identity but no business request fields are copied into it
- Production-ready is not inferred from `production-pattern`; this describes a design pattern, not validated SLAs, scalability, org-specific policy, audit or recovery
- Demo user identities, company notices, social posts, people directory and secondary workflows are synthetic; cannot be used as actual HR/IT/ERP data or approvals
- Semantic accessibility on a physical screen reader and authenticated Preview end-to-end business flows remain a **later consolidated System Test**, not a unit-test blocker
- **Current Stage6 build is not deployed to Preview by this PR.** A separate exact-SHA owner-gated code-only Preview deployment and read-only HTTP smoke require explicit approval. Production, Remote D1, migrations, Secret and Cloudflare resources are not touched
- Issue #351 development closure requires green final code/CI checks and a recorded acceptance decision. Formal authenticated Preview + physical devices/OS reader remain separate consolidated ST, even after development closure.
