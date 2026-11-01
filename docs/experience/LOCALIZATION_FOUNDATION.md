# Localization Foundation — #289, slice 1 (provider-neutral)

## Why this slice exists

#289 follows #288 under WBS #132. This slice creates a reusable presentation-only boundary for stable message catalogs and Intl date/time/number/percent/currency formatting. It is not a translation rollout or a new user preference store.

## Sources of truth and reuse

- #288 User Preferences is solely responsible for resolving authenticated locale and timezone. The localizer accepts only the ResolvedUserPreferences subset {locale, timezone}, with no browser read, user store, D1 query or localStorage key.
- #63 API error mapping owns stable server-side error codes and request IDs. A consumer can map a known code to a product-supplied UI key such as error.validation_failed; do not send translated stack traces or override authorization.
- #49 Accessibility owns text labels, aria-live and focus handling. The localizer returns plain text only; callers render text nodes, never inject raw HTML.
- #60 Performance owns request/bundle budgets. The catalog is injected by the caller; no eager global product catalog, network dependency or new npm library.

## Contract — src/shared/localization.ts

- createLocalization({ preferences, catalogs, fallbackLocale, missingMessagePolicy }) returns a provider-neutral API. Locale and timezone must already be resolved by #288.
- t("common.save") and t("validation.required", { field: "Email" }) use stable namespace.key identifiers, primitive-value interpolation and a fallback catalog. Do not put business master records or user-generated business data in UI translation catalogs.
- missingMessagePolicy="throw" supports targeted development/test failure; default "fallback" emits a safe user-facing message instead of raw internal keys and interpolation placeholders. Optional onMissing({locale,key,reason}) records no arguments, identity, credentials or business data.
- formatDateTime(isoTimestamp, options) requires an explicit timestamp offset; Intl.DateTimeFormat uses #288 timezone regardless of the caller's date format options. IANA timezone handles DST.
- formatNumber(value, options), formatPercent(fraction, options) and formatCurrency(amount, explicitISO4217Code, options) delegate to Intl.NumberFormat. No exchange-rate or currency inference based on the display locale.
- selectPlural(count) provides an Intl.PluralRules extension point without a new message parser or hardcoded product plural logic.

Example: resolveUserPreferences({policy, authenticated: true, user, device}) and pass the returned preferences into createLocalization({preferences, catalogs: {"ja-JP": {"common.save": "保存"}, "en-US": {"common.save": "Save"}}, fallbackLocale: "ja-JP"}). The returned t("common.save") changes only when the caller gives it new resolved preferences.

## Issue Change Contract / acceptance boundaries

- Focus: existing Issue #289 (Open; original 0/11 pending independent acceptance) and WBS #132. Baseline main SHA d8702b07b38cb3cf6e5ad372242ebbb7f268a0b6; policy focus [289].
- Planned Files EXACTLY THREE: src/shared/localization.ts, tests/localization-foundation.test.ts, docs/experience/LOCALIZATION_FOUNDATION.md.
- Scope/risk: pure TypeScript presentation API, targeted Node tests, design document. No deployed UI/route/API/worker/database/auth changes, no new dependency. Avoid reimplementing #288 locale resolution, #63 API error codes or #49 accessible UI.
- Validation: targeted new unit suite, TypeScript compilation, required CI validate and relevant triggered checks. Formal ST remains #694; no unrequested full physical-device exercise.
- Remaining for later #289 slices: WORKHUB reference integration, actual runtime language switching without losing route/session/dirty form, validation/error UI wiring, Email/Announcement/Report extension points, browser accessibility and performance evidence. Full product translation and business-data translation remain Out of Scope.
- Stop if schema, runtime auth, network, source dependencies, unplanned files, Preview/Production, Remote D1/Migration or Cloudflare resources become necessary. This PR stays unmerged until separate approval of its complete HEAD.
- No original completion box is checked merely because this PR exists or its CI passed. Evaluate original criteria again after delivery evidence reaches the agreed boundary.


## 2026-11-01 — #289 slice 2 (proposed PR; **not merged**)

- Base main: `a24b3bd4dd66b75c16b38f95a4d8b5ffaa39afbe`; focus `[289]`; original completion 7/11 Open. Stage, milestones and priorities unchanged.
- A compact WORKHUB *reference panel* consumes the existing #288 context. Its language selector previews `ja-JP`/`en-US`, explicitly saves through #288's CSRF/versioned user preference flow, and leaves other route/session/dirty business form state owned by their existing components. This is **not** full WORKHUB UI translation or a verified live browser journey.
- #63's existing `ApiClientError` → `toErrorViewModel` mapping can now use an allowlisted code-to-catalog adapter and localized `ErrorPresentation` actions and request IDs. Only text nodes; no backend message, raw stack, raw HTML, credential or authorization decisions.
- Email's recipient, Announcement's viewer chrome and Report's existing view-model locale/timezone now have explicit, *pure* `create*Localization` adapters. Email sending, announcement authored business content and PDF/report renderer output stay unchanged.
- Tests cover Japanese/English SSR display, localized error-code/field presentation, safe fallback, Intl timezone, and isolated audience-specific content adapters. CI is the evidence source; a targeted browser E2E checks localized accessible controls, existing session/route, unsaved travel-purpose state and zero extra preferences requests during locale preview. Full screen translation, actual Preview deployment and dedicated #60 production-build performance measurement remain separate.
- Change contract: `src/App.tsx`, `src/reference/workhub/LocalizationReferencePanel.tsx`, `src/frontend/errors/{localized,presentation,index}.ts`, `src/shared/localization-consumers.ts`, `tests/localization-reference-consumers.test.ts`, this document and `e2e/tests/workhub-localization-reference.spec.ts` = **9 files**. No API/worker/D1/schema/provider, dependency, auth policy, external provider or Cloudflare resource changes; no locale store or retranslation of business data.
- Completion remains **7/11 while this PR is unmerged**. A merged PR would still need independent evidence before any original checkbox is changed. Formal ST #694 Not Run; Preview and Production untouched. Separate exact-HEAD human approval needed to merge.

## 2026-11-01 — #289 acceptance ⑨/⑩, slice 3 proposal (unmerged)

- GitHub source of truth: main `8f31c00cae056607d03aac776e17d350727e309e`, focus `[289]`, original completion 9/11 Open. Original ⑨ runtime switch and ⑩ #49/#60 reuse are the **only** goals. No priority or milestone edit.
- **Why:** Existing WORKHUB reference preview already supports local ja/en and the existing #288 authenticated CSRF/versioned PATCH but lacked verified save → immediate UI update → subsequent authenticated GET persistence, and explicit scoped #49/#60 regression evidence.
- **Solution:** In the existing authenticated WORKHUB React tree, apply the #288 `resolved.locale` to just the Home greeting/lead and local `lang` attribute via the **same** `createWorkhubReferenceLocalization` catalog. No separate store, no new language engine, no route replacement, no full Product translation. The reference panel still owns the native selection/save interaction.
- **#49 accessibility:** Language select remains an associated-label native select; save uses an accessible button and `role=status` live confirmation, translated Home retains an h1 accessible name and a scoped `lang` tag; browser test checks these.
- **#60 performance:** The browser test checks no extra `/api/me/preferences` GET/PATCH during unsaved preview, exactly one PATCH when saving, no locale-change navigation and **zero business mutations**, while preserving a dirty travel form. This is a targeted runtime network regression, **not** Production Core Web Vitals or a universal loading benchmark. The existing full-build, browser performance & asset measurements remain the #60 source; they are not claimed complete by a fast PR check.
- **Recovery and correctness:** Save must return actual PATCH HTTP 200; the visible Home and panel remain English in-session, the same authenticated route survives, and after an explicit browser reload/reGET the saved English locale is restored without a login. Test explicitly restores a deterministic ja-JP demo preference at the end. A missing selected catalog falls back to the pre-injected local ja-JP safe text; absent key returns safe generic text, never an internal key, business record or secret.
- **Exact planned files (5):** `src/App.tsx`, `src/reference/workhub/LocalizationReferencePanel.tsx`, `e2e/tests/workhub-localization-reference.spec.ts`, `tests/localization-reference-consumers.test.ts`, this doc. Risk moderate UI/setting persistence **on local test fixture only**, no API/schema/D1/migration/Secrets/Cloudflare, dependency, CI-policy or auth changes. Formal ST #694, physical devices, Preview/Production deploy remain outside this PR.
- **Gate:** Until independently merged/verified, original Issue #289 must remain Open **9/11** and WBS #132 unchecked. No merge permitted without separate exact complete HEAD approval.
