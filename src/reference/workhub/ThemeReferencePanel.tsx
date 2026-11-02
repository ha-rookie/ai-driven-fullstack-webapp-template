import type { PropsWithChildren } from "react";
import { useUserPreferences } from "../../frontend/preferences/context";
import {
  validateUserPreferencePatch, workhubUserPreferencePolicy,
  type ResolvedUserPreferences, type ThemePreference,
} from "../../shared/user-preferences";

/** Presentation only: no additional preference store or network access. */
export function WorkhubThemeSurface({
  resolved, children,
}: PropsWithChildren<{ readonly resolved: ResolvedUserPreferences }>) {
  return <div className="workhub-theme-scope" data-theme={resolved.colorScheme}
    data-theme-mode={resolved.theme} data-theme-source={resolved.source.theme}>
    {children}
  </div>;
}

/** Empty = unset; explicit "system" is not the same preference. */
export const themeSelectionValue = (choice: ThemePreference | null | undefined): string => choice ?? "";

export const themeSelectionPatch = (value: string): ThemePreference | null =>
  validateUserPreferencePatch({ theme: value === "" ? null : value }, workhubUserPreferencePolicy).theme ?? null;

export default function ThemeReferencePanel() {
  const {
    resolved, preview, previewActive, loadStatus, saveStatus,
    sourceOfTruth, setPreview, savePreview,
  } = useUserPreferences();
  const ready = loadStatus === "ready";
  const pending = previewActive;
  return <section className="workhub-card" id="workhub-theme-reference"
    aria-labelledby="workhub-theme-reference-title">
    <h2 id="workhub-theme-reference-title">画面の配色設定</h2>
    <p>WORKHUBの表示をライト・ダーク・端末設定から選べます。ほかの画面や申請内容は変更されません。</p>
    <div className="workhub-theme-control">
      <label htmlFor="workhub-theme-choice">表示テーマ</label>
      <select id="workhub-theme-choice" value={themeSelectionValue(preview.theme)}
        disabled={!ready || saveStatus === "saving"}
        onChange={event => setPreview("theme", themeSelectionPatch(event.target.value))}>
        <option value="">既定（ユーザー設定なし）</option>
        <option value="light">ライト</option>
        <option value="dark">ダーク</option>
        <option value="system">システム（端末の設定に追従）</option>
      </select>
      <p data-theme-resolution="true">適用中：{resolved.colorScheme === "dark" ? "ダーク" : "ライト"} ／
        選択：{resolved.theme} ／ 設定元：{resolved.source.theme}</p>
      {pending && <p>未保存の設定をプレビューしています。ほかの未保存設定があれば一緒に保存されます。</p>}
      <button type="button" className="workhub-secondary-button"
        disabled={!ready || !pending || saveStatus === "saving"}
        onClick={() => void savePreview()}>表示設定を保存</button>
      <p role="status" aria-live="polite" data-preference-source={sourceOfTruth}>
        {!ready ? loadStatus === "error" ? "設定を取得できません。再度ログインして確認してください。" : "設定を読み込み中…" :
          saveStatus === "conflict" ? "他の端末で設定が変更されました。保存は完了していません。" :
          saveStatus === "error" ? "設定を保存できませんでした。入力状態は保持しています。" :
          saveStatus === "saving" ? "設定を保存しています…" :
          pending ? "未保存のプレビュー" :
          saveStatus === "saved" ? "表示設定を保存しました" : ""}
      </p>
    </div>
  </section>;
}
