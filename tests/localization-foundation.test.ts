import assert from "node:assert/strict";
import test from "node:test";

import { createLocalization, type MissingMessage } from "../src/shared/localization";
import { resolveUserPreferences, workhubUserPreferencePolicy } from "../src/shared/user-preferences";

const catalogs = {
  "ja-JP": {
    "common.save": "保存",
    "validation.required": "{field}は必須です",
    "error.validation_failed": "入力内容を確認してください",
    "items.count": "{count}件",
  },
  "en-US": {
    "common.save": "Save",
    "validation.required": "{field} is required",
    "error.validation_failed": "Check your input",
    "items.count": "{count} items",
    "common.english_only": "English-only fallback",
  },
} as const;

const resolved = (locale: "ja-JP" | "en-US", timezone = "Asia/Tokyo") =>
  resolveUserPreferences({
    policy: workhubUserPreferencePolicy,
    authenticated: true,
    user: { locale, timezone },
    device: { locale: locale === "ja-JP" ? "en-US" : "ja-JP", timezone: "UTC" },
  });

const localizer = (locale: "ja-JP" | "en-US", timezone = "Asia/Tokyo") =>
  createLocalization({ preferences: resolved(locale, timezone), catalogs, fallbackLocale: "en-US" });

test("#288 resolved user locale is authoritative; shared translation does not read browser or store", () => {
  const en = localizer("en-US");
  const ja = localizer("ja-JP");
  assert.equal(en.t("common.save"), "Save");
  assert.equal(ja.t("common.save"), "保存");
  assert.equal(en.t("validation.required", { field: "Email" }), "Email is required");
  assert.equal(ja.t("validation.required", { field: "メール" }), "メールは必須です");
  assert.equal(en.t("error.validation_failed"), "Check your input");
  assert.equal(ja.t("error.validation_failed"), "入力内容を確認してください");
});

test("message fallback is stable and never renders raw internal keys", () => {
  const messages: MissingMessage[] = [];
  const l10n = createLocalization({
    preferences: resolved("ja-JP"), catalogs, fallbackLocale: "en-US",
    onMissing: event => messages.push(event),
  });
  assert.equal(l10n.t("common.english_only"), "English-only fallback");
  assert.equal(l10n.t("secret.internal_error"), "メッセージを表示できません");
  assert.deepEqual(messages, [{ key: "secret.internal_error", locale: "ja-JP", reason: "key" }]);
  assert.equal(l10n.t("validation.required"), "メッセージを表示できません");
  assert.equal(messages.at(-1)?.reason, "parameter");
  assert.doesNotMatch(l10n.t("error.missing"), /error\.missing/);
});

test("test/development may fail on missing keys and parameters, without a new i18n library", () => {
  const strict = createLocalization({
    preferences: resolved("en-US"), catalogs, fallbackLocale: "en-US", missingMessagePolicy: "throw",
  });
  assert.throws(() => strict.t("common.missing"), /Missing localization key/);
  assert.throws(() => strict.t("items.count"), /Missing localization parameter/);
  assert.throws(() => strict.t("Common Save"), /Invalid localization message key/);
  assert.throws(() => createLocalization({
    preferences: resolved("en-US"), catalogs, fallbackLocale: "fr-FR",
  }), /fallback catalog/);
});

test("interpolation uses own primitive arguments; unknown values do not become HTML", () => {
  const l10n = localizer("en-US");
  assert.equal(l10n.t("items.count", { count: 3 }), "3 items");
  assert.equal(l10n.t("validation.required", { field: "<email>" }), "<email> is required");
  assert.equal(l10n.t("validation.required", Object.create({ field: "leak" }) as Record<string, string>),
    "Message unavailable");
});

test("resolved timezone is separate from locale; ISO UTC formats match local clock", () => {
  const ja = localizer("ja-JP");
  const en = localizer("en-US", "America/New_York");
  const timestamp = "2026-01-15T00:00:00Z";
  assert.equal(ja.formatDateTime(timestamp, { hour: "2-digit", hour12: false }), "09時");
  assert.equal(en.formatDateTime(timestamp, { hour: "2-digit", hour12: true }), "07 PM");
  assert.equal(en.formatDateTime(timestamp, { hour: "2-digit", hour12: true, timeZone: "UTC" }),
    "07 PM", "caller options cannot override #288 resolved timezone");
  assert.throws(() => ja.formatDateTime("2026-01-15T00:00:00"), /offset/);
  assert.throws(() => ja.formatDateTime("not a date"), /offset/);
});

test("DST is handled by Intl rather than a fixed time-zone offset", () => {
  const en = localizer("en-US", "America/New_York");
  assert.equal(en.formatDateTime("2026-01-15T12:00:00Z", {
    hour: "numeric", minute: "2-digit", hour12: false,
  }), "07:00");
  assert.equal(en.formatDateTime("2026-07-15T12:00:00Z", {
    hour: "numeric", minute: "2-digit", hour12: false,
  }), "08:00");
});

test("decimal, percent, and explicit currency codes follow locale, not inferred currency", () => {
  const ja = localizer("ja-JP");
  const en = localizer("en-US");
  assert.equal(ja.formatNumber(1234.5, { minimumFractionDigits: 1 }), "1,234.5");
  assert.equal(en.formatPercent(0.125, { minimumFractionDigits: 1 }), "12.5%");
  assert.equal(en.formatCurrency(1234.56, "JPY"), "¥1,235");
  assert.equal(ja.formatCurrency(1234.56, "USD"), "$1,234.56");
  assert.throws(() => en.formatCurrency(100, "usd"), /currency code/);
  assert.throws(() => en.formatNumber(Number.NaN), /number/);
  assert.throws(() => en.formatPercent(Number.POSITIVE_INFINITY), /percent/);
});

test("plural rule extension is localized without adding a domain-specific plural catalog", () => {
  const en = localizer("en-US");
  const ja = localizer("ja-JP");
  assert.equal(en.selectPlural(1), "one");
  assert.equal(en.selectPlural(2), "other");
  assert.equal(ja.selectPlural(1), "other");
});
