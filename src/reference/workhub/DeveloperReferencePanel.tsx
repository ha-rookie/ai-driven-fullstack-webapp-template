import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  developerScreens, developerSourceUrl, findDeveloperScreen,
  type DeveloperLocale, type DeveloperScreenId,
} from "./developer-reference";
import "./developer-reference.css";

interface Props {
  readonly initialScreen: DeveloperScreenId;
  readonly onClose: () => void;
}
const phrases = {
  "ja-JP": {
    intro: "業務画面を壊さず、設計上の責務と再利用部品を確認します。ログや実データは表示しません。",
    screen: "画面", scenario: "シナリオ", capability: "利用しているCapability",
    owner: "情報の正本・投影元", authorization: "権限の考え方",
    readiness: "実装状況", limits: "制約", docs: "関連資料", source: "関連ソース",
    close: "閉じる", guide: "ほかの画面も確認", disclaimer: "Reference / Developer向けです。動作例は本番導入の保証ではありません。",
    kind: { domain: "業務正本", workflow: "Workflow", projection: "表示用Projection", adapter: "連携Adapter", catalog: "カタログ" },
  },
  "en-US": {
    intro: "Explore architecture and reusable capabilities without reading application logs or business records.",
    screen: "Screen", scenario: "Scenario", capability: "Capabilities",
    owner: "Sources of truth and projections", authorization: "Authorization summary",
    readiness: "Readiness", limits: "Limitations", docs: "Related docs", source: "Related source",
    close: "Close", guide: "Browse other screens", disclaimer: "Reference / Developer use only. Demo behavior is not a production-readiness guarantee.",
    kind: { domain: "Business source", workflow: "Workflow", projection: "Read projection", adapter: "Adapter", catalog: "Catalog" },
  },
} as const;
export default function DeveloperReferencePanel({ initialScreen, onClose }: Props) {
  const [screenId, setScreenId] = useState<DeveloperScreenId>(initialScreen);
  const locale: DeveloperLocale = navigator.language.toLowerCase().startsWith("ja") ? "ja-JP" : "en-US";
  const p = phrases[locale];
  const screen = findDeveloperScreen(screenId);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), a[href]'
    );
    if (!nodes?.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };
  return <div className="workhub-developer-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="workhub-developer-sheet" role="dialog" aria-modal="true"
      aria-label="Developer Mode" ref={panelRef} onKeyDown={onKeyDown}>
      <header className="workhub-developer-sheet-header">
        <div><span className="workhub-card-label">DEVELOPER MODE / REFERENCE</span>
          <h2>Developer Mode</h2></div>
        <button type="button" className="workhub-secondary-button" ref={closeRef} onClick={onClose}>{p.close}</button>
      </header>
      <div className="workhub-developer-sheet-content">
        <p>{p.intro}</p>
        <label className="workhub-developer-screen-picker" htmlFor="workhub-developer-screen">
          {p.guide}
          <select id="workhub-developer-screen" value={screenId}
            onChange={event => setScreenId(event.target.value as DeveloperScreenId)}>
            {developerScreens.map(item =>
              <option value={item.id} key={item.id}>{item.title[locale === "ja-JP" ? "ja" : "en"]}</option>)}
          </select>
        </label>
        <div className="workhub-developer-screen-id">
          <h3>{p.screen}: {screen.title[locale === "ja-JP" ? "ja" : "en"]}</h3>
          <p><code>workhub.{screen.id}</code> / {p.scenario}: <code>{screen.scenario}</code></p>
        </div>
        <section><h3>{p.capability}</h3><ul>{screen.capabilities.map(x => <li key={x}>{x}</li>)}</ul></section>
        <section><h3>{p.owner}</h3>
          <dl>{screen.sourceOfTruth.map(x => <div key={x.view}>
            <dt>{x.view} <span className="workhub-developer-kind">{p.kind[x.kind]}</span></dt>
            <dd>{x.owner}</dd>
          </div>)}</dl>
        </section>
        <section><h3>{p.authorization}</h3><p>{screen.authorization}</p></section>
        <section><h3>{p.readiness}</h3><ul>{screen.readiness.map(x => <li key={x.component}>
          <strong>{x.component}</strong>: <code>{x.state}</code>
        </li>)}</ul></section>
        <section><h3>{p.limits}</h3><ul>{screen.limitations.map(x => <li key={x}>{x}</li>)}</ul></section>
        <section><h3>{p.docs}</h3>{screen.docs.length
          ? <ul>{screen.docs.map(x => <li key={x}><a href={developerSourceUrl(x) ?? undefined}
              target="_blank" rel="noopener noreferrer">{x}</a></li>)}</ul>
          : <p>—</p>}</section>
        <section><h3>{p.source}</h3><ul>{screen.source.map(x => <li key={x}><a
          href={developerSourceUrl(x) ?? undefined} target="_blank" rel="noopener noreferrer">{x}</a></li>)}</ul></section>
        <p className="workhub-developer-disclaimer">{p.disclaimer}</p>
      </div>
    </section>
  </div>;
}
