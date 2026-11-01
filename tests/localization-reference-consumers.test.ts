import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiClientError } from "../src/frontend/api";
import { ErrorPresentation, createLocalizedErrorCopyResolver, toErrorViewModel } from "../src/frontend/errors";
import { createLocalization } from "../src/shared/localization";
import {
  createAnnouncementChromeLocalization, createEmailTemplateLocalization, createReportRendererLocalization,
} from "../src/shared/localization-consumers";
import {
  createWorkhubReferenceLocalization, LocalizationReferencePreview,
} from "../src/reference/workhub/LocalizationReferencePanel";

const source = {
  fallbackLocale: "ja-JP",
  catalogs: {
    "ja-JP": { "template.subject": "お知らせ", "template.body": "こんにちは",
      "announcement.date": "掲載日", "report.title": "帳票" },
    "en-US": { "template.subject": "Notice", "template.body": "Hello",
      "announcement.date": "Published", "report.title": "Report" },
  },
};
const ja = { locale: "ja-JP", timezone: "Asia/Tokyo" };
const en = { locale: "en-US", timezone: "Asia/Tokyo" };

test("the existing #288 resolved recipient/viewer/report locale is the only presentation source", () => {
  const email = createEmailTemplateLocalization(en, source);
  assert.equal(email.t("template.subject"), "Notice");
  assert.equal(email.t("template.body"), "Hello");
  assert.equal(createEmailTemplateLocalization(ja, source).t("template.subject"), "お知らせ");
  assert.equal(createAnnouncementChromeLocalization(en, source).t("announcement.date"), "Published");
  assert.equal(createReportRendererLocalization({ locale: "ja-JP", timezone: "Asia/Tokyo" }, source).t("report.title"), "帳票");
  assert.equal(createAnnouncementChromeLocalization(en, source).formatDateTime(
    "2026-01-15T00:00:00Z", { hour: "2-digit", hour12: false }), "09");
});

test("API machine codes use allowlisted localized copy but never raw response text", () => {
  const catalogs = {
    "ja-JP": {
      "error.validation.title": "入力に問題があります",
      "error.validation.message": "入力を確認してください",
      "error.validation.field": "値を確認してください",
      "error.code.validation_failed": "入力が不正です",
      "error.action.retry": "再試行",
      "error.request_id": "受付番号: {id}",
    },
    "en-US": {
      "error.validation.title": "Check input",
      "error.validation.message": "Check values",
      "error.validation.field": "Check this field",
      "error.code.validation_failed": "Invalid input",
      "error.action.retry": "Retry",
      "error.request_id": "Request ID: {id}",
    },
  };
  const error = new ApiClientError("http", "private stack trace", {
    status: 422, requestId: "req-289",
    apiError: { requestId: "req-289",
      error: { code: "validation_failed", message: "secret server detail",
        issues: [{ code: "required", path: "email", message: "raw database detail" }] } },
  });
  for (const [locale, expected] of [["ja-JP", "入力が不正です"], ["en-US", "Invalid input"]] as const) {
    const l10n = createLocalization({ preferences: { locale, timezone: "UTC" }, catalogs, fallbackLocale: "ja-JP" });
    const model = toErrorViewModel(error, createLocalizedErrorCopyResolver(l10n));
    const markup = renderToStaticMarkup(createElement(ErrorPresentation, { error: model, localization: l10n }));
    assert.match(markup, new RegExp(expected));
    assert.match(markup, /data-field-path="email"/);
    assert.match(markup, /role="alert"/);
    assert.doesNotMatch(markup, /private stack|secret server detail|raw database detail/);
  }
});

test("WORKHUB reference re-renders ja/en texts, preserves IANA timezone and accessible labels", () => {
  const japanese = renderToStaticMarkup(createElement(LocalizationReferencePreview, { preferences: ja }));
  const english = renderToStaticMarkup(createElement(LocalizationReferencePreview, { preferences: en }));
  assert.match(japanese, /lang="ja-JP"/);
  assert.match(japanese, /日本語表示/);
  assert.match(english, /lang="en-US"/);
  assert.match(english, /English display/);
  assert.match(english, /12,345.67/);
  assert.match(japanese, /<details>/);
  assert.match(english, /role="alert"/);
  assert.doesNotMatch(japanese + english, /private|secret|raw database/);
});

test("safe fallback never leaks a missing catalog's internal translation key", () => {
  const l10n = createWorkhubReferenceLocalization({ locale: "en-US", timezone: "UTC" });
  assert.equal(l10n.t("reference.title"), "Localization example");
  assert.equal(l10n.t("missing.secret"), "Message unavailable");
});
