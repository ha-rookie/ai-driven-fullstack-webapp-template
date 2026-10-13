import { useState } from "react";
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
    status: { "implemented-reference": "Reference実装の導線あり", "reference-mock": "模擬Workflowのみ", "catalog-only": "構想・ガイド例のみ" },
    noScreen: "ガイドと連動する完成画面はまだありません",
    learning: "導入ガイド・始め方", start: "初めての方へ：画面からソースまで追う手順",
    limitations: "注意：Developer Modeの閲覧は業務データへのアクセス権を増やしません。Demoが動作することはProduction Readyを意味しません。",
  },
  "en-US": {
    title: "Developer Guide", overview: "Understand boundaries and reusable parts",
    intro: "Static Reference architecture; no business records, permissions, or logs are fetched.",
    architecture: "Architecture Map", flow: "UI and auth guard lead to authoritative domains; read models and external adapters are not authoritative.",
    capabilities: "Capability Map", onScreens: "Used by screens", open: "Open screen reference",
    scenarios: "Scenario Catalog", persona: "Personas", screenCatalog: "Screen Catalog", adapters: "Adapter / Integration Map", mapping: "Integration boundary", adapterNone: "See screen reference for connected systems",
    status: { "implemented-reference": "Linked Reference journey", "reference-mock": "Mock workflow only", "catalog-only": "Concept / guide only" },
    noScreen: "No complete linked screen journey is registered",
    learning: "Developer onboarding", start: "Getting started: trace a screen to its source",
    limitations: "Developer Mode never expands access to business records. A working demo does not mean Production Ready.",
  },
} as const;

export default function DeveloperGuideOverview({ locale, onOpenScreen }: Props) {
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
