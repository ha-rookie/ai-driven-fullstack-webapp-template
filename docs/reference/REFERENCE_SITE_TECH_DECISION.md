# Reference Site technology / hosting decision — #433

Date: 2026-10-19
Scope: #433 first implemented slice only. WBS #132, original #433 Completion Gate and milestones remain unchanged.

## Decision: reuse the running React/Vite/Cloudflare application

Use **the existing React 19 + TypeScript + Vite 8 client build** and the **existing Cloudflare Workers static Assets SPA fallback** to serve an unauthenticated read-only Reference view at `/reference` and `/reference/`. This route lives beside `/showcase` (visitor-facing guided demo) and `/` (authenticated WORKHUB reference application), not inside a protected business page. `src/main.tsx` remains the route authority: unknown paths stay on the existing safe Not Found component.

This is a **code-level choice**. No Preview/Production deployment or Cloudflare resource action is approved or performed by this PR. Actual remote visibility must not be claimed until a separately authorized deployment is verified.

| Option | Incremental cost / fit | Decision |
| --- | --- | --- |
| Existing React + Vite + Workers static assets | No new runtime, dependency, migration, service or hosting decision; reuse established public route and CI | **Select for first slice** |
| Astro / static-first docs build | Useful for large-volume generated MD/SEO later, but separate setup/build/deployment and conversion cost now | Defer; no measured demand |
| Docusaurus / standalone docs service | Rich docs navigation/search, but new site/toolchain and hosting maintenance for a three-capability first slice | Defer |
| New SSR Worker / D1-backed CMS / dynamic search API | Adds operational and security boundaries without need for this static reference | Reject for first slice |

This selection is based on current repository evidence and constrained scope, **not** an external performance benchmark. Re-evaluate if real docs volume, accessibility, navigation, SEO or search requirements outgrow the established SPA.

## One Issue Change Contract

- **Goal:** WORKHUB capability readers move from a clear Reference start to a representative Recipe, live/demo entry, actual source and tests.
- **Existing truth:** GitHub Issues, docs, source and CI are authoritative. This view only links them; do not create a competing database or secretly mark incomplete conditions done.
- **In-scope:** `/reference` public route, three representative Business / Platform / Operations cards, an existing `/showcase` link into the new view, responsive minimal CSS and focused browser regression evidence.
- **Out-of-scope:** new core functionality, editing WORKHUB business data, real Recovery or Production verification, authentication bypass, auto-login, remote D1, new backend, new dependencies, CI policy changes, deploy or release.
- **Link semantics:** WORKHUB `/` is an authenticated demo and may mutate synthetic Preview data; public `/showcase` and `/reference` do not request `/api/*`. Recovery is simulated and cannot execute Production restore/resume.
- **Maturity vs verification:** label implementation separately from CI evidence. A source/test link means it can be inspected; it does not constitute current Production validation. Never infer `Preview Verified` or `Production Verified` from CI or links.
- **Known limitation:** curated reference cards link to existing documentation and tests. The full #433 taxonomy, richer search/navigation, ADR registry, broken-link automation, and release review remain future acceptance work **within #433**. The initial static SPA does not have generated indexed documentation or runtime content freshness updates.
- **Safety:** no remote API/data operations; no D1 migration, secrets, Cloudflare config or new service.

## Concrete routes / evidence

| Purpose | Existing or new path |
| --- | --- |
| First-look showcase | `/showcase` (existing) |
| Read Reference | `/reference` (new, static, public) |
| Authenticated real demo | `/` (existing WORKHUB) |
| Workflow Recipe | `docs/recipes/REFERENCE_TRAVEL_REQUEST.md` |
| Workflow Source / Browser Evidence | `src/reference/workhub/travel-request/service.ts` / `e2e/tests/workhub-travel-request.spec.ts` |
| Authorization Recipe | `docs/recipes/AUTHORIZATION_BOUNDARY.md` |
| Recovery Design / simulated source & test | `docs/RECOVERY_OPERATIONS.md` / `src/shared/recovery/readiness.ts` / `tests/recovery-showcase.test.ts` |
| First slice browser safety test | `e2e/tests/reference-site.spec.ts` |

## Verification boundary

On PR creation, verify base-main Work Selection focus #433 and changed file contract; run the required CI, TypeScript/Vite build, representative public-route Playwright checks and related tests triggered by CI. The new browser checks cover `/reference`, `/reference/`, Showcase-to-Reference link, desktop content, 390px mobile overflow and no `/api/*` calls. **Passing local CI does not certify deployed Preview or Production**. The separate #694 formal system test remains Not Run, #430 cross-cutting quality remains open, and #475 external evaluation remains open.

## Later within original #433 (not added acceptance)

Continue existing #433 completion criteria in their original wording and sequence: information architecture, metadata/ADR policy, capability inventory, WORKHUB mappings, recipe taxonomy, status model, search/navigation, accessibility/responsive, full Reference implementation, Docs → Demo → Source, accurate status, broken link checking and release readiness. None is silently marked complete by this first slice; evidence should be assessed independently **after merge**.
