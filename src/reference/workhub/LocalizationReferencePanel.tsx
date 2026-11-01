import { useMemo } from "react";
import { ApiClientError } from "../../frontend/api";
import { ErrorPresentation, createLocalizedErrorCopyResolver, toErrorViewModel } from "../../frontend/errors";
import { useUserPreferences } from "../../frontend/preferences/context";
import { createLocalization, type LocalizationPreferences } from "../../shared/localization";

const catalogs = {
  "ja-JP": {
    "reference.title": "表示言語のサンプル",
    "reference.description": "設定を変更しても、現在のページ・ログイン・入力途中の申請は保持されます。",
    "reference.language": "表示言語",
    "reference.save": "言語設定を保存",
    "reference.saved": "保存しました",
    "reference.pending": "保存前の表示を確認中",
    "reference.loading": "設定を読み込み中",
    "reference.failed": "設定を保存できません。状態を確認してください。",
    "reference.example": "日本語表示",
    "reference.home_greeting": "おはようございます、{name}さん",
    "reference.home_lead": "仕事の入口を、ひとつに。今日やることから始めましょう。",
    "reference.date": "日時",
    "reference.number": "数値",
    "reference.money": "金額",
    "reference.error": "入力エラー表示例（実際の申請エラーではありません）",
    "error.validation.title": "入力内容を確認",
    "error.validation.message": "修正が必要な項目があります。",
    "error.validation.field": "この値を確認してください。",
    "error.code.validation_failed": "入力内容を確認してください。",
    "error.action.retry": "再試行",
    "error.action.refresh": "更新",
    "error.action.reauthenticate": "ログイン",
    "error.request_id": "リクエストID: {id}",
  },
  "en-US": {
    "reference.title": "Localization example",
    "reference.description": "Changing language keeps your route, session and unfinished request form.",
    "reference.language": "Display language",
    "reference.save": "Save language preference",
    "reference.saved": "Saved",
    "reference.pending": "Previewing unsaved preference",
    "reference.loading": "Loading preferences",
    "reference.failed": "Unable to save. Check your current preference status.",
    "reference.example": "English display",
    "reference.home_greeting": "Good morning, {name}",
    "reference.home_lead": "One place to start your work. Let’s begin with today’s tasks.",
    "reference.date": "Date and time",
    "reference.number": "Number",
    "reference.money": "Amount",
    "reference.error": "Validation example (not a real request error)",
    "error.validation.title": "Check entered values",
    "error.validation.message": "Some fields need attention.",
    "error.validation.field": "Check this value.",
    "error.code.validation_failed": "Check your input.",
    "error.action.retry": "Try again",
    "error.action.refresh": "Refresh",
    "error.action.reauthenticate": "Sign in",
    "error.request_id": "Request ID: {id}",
  },
} as const;

export const createWorkhubReferenceLocalization = (preferences: LocalizationPreferences) =>
  createLocalization({ preferences, catalogs, fallbackLocale: "ja-JP" });

/** Local fixture only: no network call and no form mutation. */
const referenceError = new ApiClientError("http", "private implementation detail", {
  status: 422,
  apiError: {
    error: { code: "validation_failed", message: "private backend message",
      issues: [{ path: "email", code: "required", message: "private validation detail" }] },
    requestId: "reference-only",
  },
});

export const LocalizationReferencePreview = ({ preferences }: { readonly preferences: LocalizationPreferences }) => {
  const l10n = useMemo(() => createWorkhubReferenceLocalization(preferences), [preferences.locale, preferences.timezone]);
  const model = useMemo(() => toErrorViewModel(referenceError, createLocalizedErrorCopyResolver(l10n)), [l10n]);
  return <div lang={preferences.locale} data-localization-reference-content="true">
    <p>{l10n.t("reference.example")}</p>
    <dl>
      <dt>{l10n.t("reference.date")}</dt><dd>{l10n.formatDateTime("2026-10-31T12:00:00Z", { dateStyle: "medium", timeStyle: "short" })}</dd>
      <dt>{l10n.t("reference.number")}</dt><dd>{l10n.formatNumber(12345.67, { minimumFractionDigits: 2 })}</dd>
      <dt>{l10n.t("reference.money")}</dt><dd>{l10n.formatCurrency(1234, "JPY")}</dd>
    </dl>
    <details>
      <summary>{l10n.t("reference.error")}</summary>
      <ErrorPresentation error={model} localization={l10n} />
    </details>
  </div>;
};

/** Embedded in WORKHUB rather than a separate app, preserving ancestor form state and auth. */
export default function LocalizationReferencePanel() {
  const { resolved, setPreview, savePreview, previewActive, loadStatus, saveStatus } = useUserPreferences();
  const l10n = useMemo(() => createWorkhubReferenceLocalization(resolved), [resolved.locale, resolved.timezone]);
  const ready = loadStatus === "ready";
  return <section id="workhub-locale-reference" aria-labelledby="workhub-locale-reference-title" className="workhub-card" lang={resolved.locale}>
    <h2 id="workhub-locale-reference-title">{l10n.t("reference.title")}</h2>
    <p>{l10n.t("reference.description")}</p>
    <label htmlFor="workhub-language-choice">{l10n.t("reference.language")}</label>
    <select id="workhub-language-choice" value={resolved.locale} disabled={!ready || saveStatus === "saving"}
      onChange={(event) => setPreview("locale", event.target.value)}>
      <option value="ja-JP">日本語</option>
      <option value="en-US">English</option>
    </select>
    <button type="button" className="workhub-secondary-button"
      disabled={!ready || !previewActive || saveStatus === "saving"}
      onClick={() => void savePreview()}>{l10n.t("reference.save")}</button>
    <p role="status" aria-live="polite">
      {!ready ? l10n.t("reference.loading") :
        saveStatus === "conflict" || saveStatus === "error" ? l10n.t("reference.failed") :
        previewActive ? l10n.t("reference.pending") :
        saveStatus === "saved" ? l10n.t("reference.saved") : ""}
    </p>
    <LocalizationReferencePreview preferences={resolved} />
  </section>;
}
