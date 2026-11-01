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

