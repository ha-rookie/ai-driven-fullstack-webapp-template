import { useState } from "react";
import { useUserPreferences } from "../../frontend/preferences/context";
import {
  developerArchitectureLayers, developerCapabilityMap, developerGuideScenarios, developerAdapterMap,
} from "./developer-guide";
import {
  developerScreens, developerSourceUrl,
  type DeveloperLocale, type DeveloperScreenId,
} from "./developer-reference";

interface Props {
  readonly locale: DeveloperLocale;
  readonly onOpenScreen: (screen: DeveloperScreenId) => void;
}
const guideText = {
  "ja-JP": {
    title: "Developer Guide", overview: "構造と再利用範囲を学ぶ",
    intro: "以下は静的なReference設計ガイドです。実データ、権限やログを取得しません。",
    architecture: "Architecture Map", flow: "上から業務画面・権限境界・正本。下位の表示・外部連携は正本ではありません。",
    capabilities: "Capability Map", onScreens: "利用する画面", open: "この画面の詳細を開く",
    scenarios: "Scenario Catalog", persona: "想定する人", screenCatalog: "Screen Catalog", adapters: "Adapter / Integration Map", mapping: "連携境界", adapterNone: "接続先は画面情報を参照",
    status: { "implemented-reference": "Reference実装の導線あり", "partial-reference": "部分実装・正式System Test未実施", "reference-mock": "模擬Workflowのみ", "catalog-only": "構想・ガイド例のみ" },
    noScreen: "ガイドと連動する完成画面はまだありません",
    evidenceDoc: "実装と未完了の確認表",
    learning: "導入ガイド・始め方", start: "初めての方へ：画面からソースまで追う手順",
    limitations: "注意：Developer Modeの閲覧は業務データへのアクセス権を増やしません。Demoが動作することはProduction Readyを意味しません。",
  },
  "en-US": {
    title: "Developer Guide", overview: "Understand boundaries and reusable parts",
    intro: "Static Reference architecture; no business records, permissions, or logs are fetched.",
    architecture: "Architecture Map", flow: "UI and auth guard lead to authoritative domains; read models and external adapters are not authoritative.",
    capabilities: "Capability Map", onScreens: "Used by screens", open: "Open screen reference",
    scenarios: "Scenario Catalog", persona: "Personas", screenCatalog: "Screen Catalog", adapters: "Adapter / Integration Map", mapping: "Integration boundary", adapterNone: "See screen reference for connected systems",
    status: { "implemented-reference": "Linked Reference journey", "partial-reference": "Partially implemented; formal System Test pending", "reference-mock": "Mock workflow only", "catalog-only": "Concept / guide only" },
    noScreen: "No complete linked screen journey is registered",
    evidenceDoc: "Evidence and remaining gaps",
    learning: "Developer onboarding", start: "Getting started: trace a screen to its source",
    limitations: "Developer Mode never expands access to business records. A working demo does not mean Production Ready.",
  },
} as const;

export default function DeveloperGuideOverview({ locale, onOpenScreen }: Props) {
  const preference = useUserPreferences();
  const [scenarioId, setScenarioId] = useState(developerGuideScenarios[0].id);
  const labels = guideText[locale];
  const scenario = developerGuideScenarios.find(item => item.id === scenarioId) ?? developerGuideScenarios[0];
  const capabilityMap = developerCapabilityMap();
  const displayName = (id: DeveloperScreenId) => {
    const screen = developerScreens.find(item => item.id === id);
    return screen?.title[locale === "ja-JP" ? "ja" : "en"] ?? id;
  };
  return <div className="workhub-developer-overview">
    <h3>{labels.title}</h3>
    <p>{labels.overview} — {labels.intro}</p>
    <section aria-label="User Preferences Reference">
      <h4>User Preferences / Resolved Experience</h4>
      <p>{locale === "ja-JP"
        ? "端末情報とProject既定値から共通Resolverで解決した表示候補です。ログイン利用者の保存設定は未接続で、この値は保存されません。画面全体の翻訳・配色変更も未実装です。"
        : "Reference values resolved from device signals and project defaults. Saved user preferences are not connected or persisted; full-app translation and theme changes are not implemented."}</p>
      <dl>
        <div><dt>Locale</dt><dd>{preference.resolved.locale} ({preference.resolved.source.locale})</dd></div>
        <div><dt>Timezone</dt><dd>{preference.resolved.timezone} ({preference.resolved.source.timezone})</dd></div>
        <div><dt>Theme / Color scheme</dt><dd>{preference.resolved.theme} / {preference.resolved.colorScheme} ({preference.resolved.source.theme})</dd></div>
      </dl>
      <fieldset className="workhub-preference-preview-fields">
        <legend>{locale === "ja-JP" ? "設定プレビュー（この画面内だけ・未保存）" : "Settings preview (this session only; not saved)"}</legend>
        <label htmlFor="workhub-preference-preview-locale">
          {locale === "ja-JP" ? "言語" : "Language"}
          <select id="workhub-preference-preview-locale" value={preference.preview.locale ?? ""}
            onChange={event => preference.setPreview("locale", event.target.value || null)}>
            <option value="">{locale === "ja-JP" ? "端末・既定値" : "Device / default"}</option>
            <option value="ja-JP">日本語 (ja-JP)</option>
            <option value="en-US">English (en-US)</option>
          </select>
        </label>
        <label htmlFor="workhub-preference-preview-timezone">
          {locale === "ja-JP" ? "タイムゾーン" : "Timezone"}
          <select id="workhub-preference-preview-timezone" value={preference.preview.timezone ?? ""}
            onChange={event => preference.setPreview("timezone", event.target.value || null)}>
            <option value="">{locale === "ja-JP" ? "端末・既定値" : "Device / default"}</option>
            <option value="Asia/Tokyo">Asia/Tokyo</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York</option>
          </select>
        </label>
        <label htmlFor="workhub-preference-preview-theme">
          {locale === "ja-JP" ? "配色" : "Appearance"}
          <select id="workhub-preference-preview-theme" value={preference.preview.theme ?? ""}
            onChange={event => preference.setPreview("theme", event.target.value || null)}>
            <option value="">{locale === "ja-JP" ? "端末・既定値" : "Device / default"}</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">{locale === "ja-JP" ? "OSに追従 (system)" : "Follow OS (system)"}</option>
          </select>
        </label>
      </fieldset>
      <div className="workhub-preference-preview-action">
        <button type="button" className="workhub-secondary-button"
          disabled={!preference.previewActive}
          onClick={preference.resetPreview}>{locale === "ja-JP" ? "プレビューを初期化" : "Reset preview"}</button>
        <small role="status">{preference.previewActive
          ? (locale === "ja-JP" ? "一時プレビュー中・保存されません" : "Session preview only — not saved")
          : (locale === "ja-JP" ? "端末・既定値を表示中" : "Device / defaults shown")}</small>
      </div>
      <div className="workhub-preference-preview-example"
        data-preview-scheme={preference.resolved.colorScheme} aria-live="polite">
        <strong>{locale === "ja-JP" ? "表示例（このカード内だけ）" : "Sample display (this card only)"}</strong>
        <span>{new Intl.DateTimeFormat(preference.resolved.locale, {
          timeZone: preference.resolved.timezone, dateStyle: "medium", timeStyle: "short",
        }).format(new Date("2026-10-28T12:00:00.000Z"))}</span>
        <small>{preference.resolved.locale} · {preference.resolved.timezone} · {preference.resolved.colorScheme}</small>
      </div>
    </section>
    <section aria-labelledby="workhub-developer-architecture-heading">
      <h4 id="workhub-developer-architecture-heading">{labels.architecture}</h4>
      <p>{labels.flow}</p>
      <ol className="workhub-developer-architecture" aria-label={labels.architecture}>
        {developerArchitectureLayers.map(layer => <li key={layer.id}>
          <strong>{locale === "ja-JP" ? layer.ja : layer.en}</strong>
          <span>{locale === "ja-JP" ? layer.detailJa : layer.detailEn}</span>
        </li>)}
      </ol>
    </section>
    <section aria-labelledby="workhub-developer-capabilities-heading">
      <h4 id="workhub-developer-capabilities-heading">{labels.capabilities}</h4>
      <ul className="workhub-developer-capability-list">{capabilityMap.map(item =>
        <li key={item.id}>
          <strong>{item.id}</strong>
          <span>{labels.onScreens}: </span>
          <div className="workhub-developer-inline-actions">{item.screens.map(id =>
            <button type="button" key={id} className="workhub-secondary-button"
              aria-label={`${labels.open}: ${displayName(id)} — ${item.id}`}
              onClick={() => onOpenScreen(id)}>{displayName(id)}</button>)}</div>
        </li>)}</ul>
    </section>
    <section aria-labelledby="workhub-developer-scenarios-heading">
      <h4 id="workhub-developer-scenarios-heading">{labels.scenarios}</h4>
      <label className="workhub-developer-screen-picker" htmlFor="workhub-developer-scenario">{labels.scenarios}
        <select id="workhub-developer-scenario" value={scenarioId}
          onChange={e => setScenarioId(e.target.value)}>
          {developerGuideScenarios.map(item =>
            <option key={item.id} value={item.id}>{locale === "ja-JP" ? item.ja : item.en}</option>)}
        </select>
      </label>
      <div className="workhub-developer-scenario" aria-live="polite">
        <p><strong>{labels.status[scenario.kind]}</strong></p>
        <p>{labels.persona}: {locale === "ja-JP" ? scenario.personaJa : scenario.personaEn}</p>
        <p>{locale === "ja-JP" ? scenario.noteJa : scenario.noteEn}</p>
        {scenario.screens.length ? <div className="workhub-developer-inline-actions">
          {scenario.screens.map(id => <button key={id} type="button" className="workhub-secondary-button"
            aria-label={`${labels.open}: ${displayName(id)} — ${scenario.id}`}
            onClick={() => onOpenScreen(id)}>{displayName(id)}</button>)}
        </div> : <p>{labels.noScreen}</p>}
        {scenario.evidenceDoc && <p><a href={developerSourceUrl(scenario.evidenceDoc) ?? undefined}
          target="_blank" rel="noopener noreferrer">{labels.evidenceDoc}</a></p>}
      </div>
    </section>
    <section aria-labelledby="workhub-developer-screen-catalog-heading">
      <h4 id="workhub-developer-screen-catalog-heading">{labels.screenCatalog}</h4>
      <div className="workhub-developer-inline-actions">{developerScreens.map(screen =>
        <button type="button" key={screen.id} className="workhub-secondary-button"
          aria-label={`${labels.open}: ${displayName(screen.id)} — workhub.${screen.id}`}
          onClick={() => onOpenScreen(screen.id)}>{displayName(screen.id)} <code>{screen.id}</code></button>)}
      </div>
    </section>
    <section aria-labelledby="workhub-developer-adapters-heading">
      <h4 id="workhub-developer-adapters-heading">{labels.adapters}</h4>
      <ul className="workhub-developer-capability-list">{developerAdapterMap().map(item =>
        <li key={`${item.screen}-${item.view}`}>
          <strong>{item.view} {item.mock ? "(mock)" : ""}</strong>
          <p>{labels.mapping}: {item.owner}</p>
          <button className="workhub-secondary-button" type="button"
            onClick={() => onOpenScreen(item.screen)}>{displayName(item.screen)}</button>
        </li>)}</ul>
    </section>
    <section aria-labelledby="workhub-developer-learning-heading">
      <h4 id="workhub-developer-learning-heading">{labels.learning}</h4>
      <a href={developerSourceUrl("docs/reference/WORKHUB_DEVELOPER_GUIDE.md") ?? undefined}
        rel="noopener noreferrer" target="_blank">{labels.start}</a>
    </section>
    <p className="workhub-developer-disclaimer">{labels.limitations}</p>
  </div>;
}
