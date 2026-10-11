import { useEffect, useMemo, useState } from "react";
import { selectWorkhubHomeShortcuts, type WorkhubAppEntry } from "./app-catalog";
import { listWorkhubRequestIntents } from "./request-intents";

type LoadState = "loading" | "ready" | "unavailable" | "forbidden";

/** Stage 1 Basic App Launcher; current membership is resolved only by the Worker. */
export default function WorkhubAppLauncher() {
  const [apps, setApps] = useState<readonly WorkhubAppEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [refresh, setRefresh] = useState(0);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    setState("loading");
    void (async () => {
      try {
        const response = await fetch("/api/workhub/apps", {
          headers: { accept: "application/json" },
          credentials: "same-origin",
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        if (response.status === 403) { setState("forbidden"); return; }
        if (!response.ok) throw new Error("app_catalog_unavailable");
        const result = await response.json() as { items?: WorkhubAppEntry[] };
        if (!Array.isArray(result.items)) throw new Error("app_catalog_invalid");
        if (!abort.signal.aborted) { setApps(result.items); setState("ready"); }
      } catch {
        if (!abort.signal.aborted) setState("unavailable");
      }
    })();
    return () => abort.abort();
  }, [refresh]);

  const homeShortcuts = useMemo(() => selectWorkhubHomeShortcuts(apps), [apps]);
  const requestIntents = useMemo(() => listWorkhubRequestIntents(apps), [apps]);
  const categories = useMemo(() => Array.from(new Set(apps.map(app => app.category))), [apps]);
  const visibleApps = useMemo(() => apps.filter(app =>
    (category === "all" || app.category === category)
    && (query.trim() === "" || [app.displayName, app.description, app.category]
      .some(value => value.toLocaleLowerCase("ja-JP").includes(query.trim().toLocaleLowerCase("ja-JP")))),
  ), [apps, category, query]);

  return <>
    <section className="workhub-home-apps" aria-labelledby="workhub-home-apps-title">
      <div className="workhub-section-heading">
        <div><span className="workhub-card-label">APP SHORTCUTS</span><h2 id="workhub-home-apps-title">よく使うアプリ</h2></div>
        <a href="#workhub-apps" className="workhub-home-apps-all">アプリ一覧を見る →</a>
      </div>
      <p className="workhub-reference-note">デモ用の固定ショートカットです。利用履歴やお気に入り順ではありません。</p>
      {state === "loading" && <p>利用できるアプリを読み込んでいます…</p>}
      {state === "forbidden" && <p>現在の所属・権限ではアプリを表示できません。</p>}
      {state === "unavailable" && <p>アプリ情報を取得できませんでした。下のアプリ一覧から再読み込みできます。</p>}
      {state === "ready" && (homeShortcuts.length === 0
        ? <p className="workhub-empty-state">現在起動できるアプリはありません。</p>
        : <div className="workhub-home-apps-grid">
          {homeShortcuts.map(app => <a key={app.key} className="workhub-home-apps-card" href={app.launchTarget}>
            <span className="workhub-card-label">{app.category}</span>
            <strong>{app.displayName}</strong>
            <small>{app.description}</small>
            <span className="workhub-home-apps-open" aria-hidden="true">開く →</span>
          </a>)}
        </div>)}
    </section>
    <section className="workhub-request-intents" id="workhub-request-intents" aria-labelledby="workhub-request-intents-title">
      <div className="workhub-section-heading">
        <div><span className="workhub-card-label">REQUESTS / INTENT CATALOG</span><h2 id="workhub-request-intents-title">申請・手続きを探す</h2></div>
      </div>
      <p className="workhub-reference-note">システム名ではなく、やりたいことから選びます。実装済みの業務だけ起動できます。</p>
      {state === "loading" && <p role="status">利用できる手続きを確認しています…</p>}
      {state === "forbidden" && <p role="alert">所属・権限を確認できません。申請画面への導線は表示できません。</p>}
      {state === "unavailable" && <div role="alert"><p>手続きを取得できませんでした。アプリ一覧から再読み込みしてください。</p><a href="#workhub-apps">アプリ一覧へ</a></div>}
      {state === "ready" && <div className="workhub-request-intent-grid">
        {requestIntents.map(intent => <article className="workhub-request-intent-card" key={intent.key}>
          <h3>{intent.title}</h3>
          <p>{intent.description}</p>
          <ol>{intent.steps.map(step => <li key={step}>{step}</li>)}</ol>
          {intent.availability === "connected" && intent.target
            ? <a className="workhub-request-intent-open" href={intent.target}>手続きを開く →</a>
            : <span className="workhub-request-intent-guide">手順の案内のみ・申請は未接続</span>}
        </article>)}
      </div>}
    </section>
    <section className="workhub-app-launcher" id="workhub-apps" tabIndex={-1} aria-labelledby="workhub-apps-title">
    <div className="workhub-section-heading">
      <div><span className="workhub-card-label">APPS / APP LAUNCHER</span><h2 id="workhub-apps-title">アプリを探す</h2></div>
    </div>
    <p className="workhub-reference-note">現在のアクセス権限で利用できる社内アプリを表示します。未接続のアプリは起動できません。</p>
    {state === "loading" && <p role="status">アプリ一覧を読み込んでいます…</p>}
    {state === "forbidden" && <p role="alert">現在の所属・権限ではアプリ一覧を表示できません。</p>}
    {state === "unavailable" && <div role="alert"><p>アプリ一覧を取得できませんでした。アプリが0件とは限りません。</p><button type="button" className="workhub-secondary-button" onClick={() => setRefresh(value => value + 1)}>再読み込み</button></div>}
    {state === "ready" && <>
      <div className="workhub-app-filters">
        <label>アプリを検索<input type="search" aria-controls="workhub-app-results" value={query} onChange={event => setQuery(event.target.value)} placeholder="アプリ名・業務から探す" /></label>
        <label>カテゴリ<select aria-controls="workhub-app-results" value={category} onChange={event => setCategory(event.target.value)}><option value="all">すべて</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <p className="workhub-app-result-count" role="status" aria-live="polite" aria-atomic="true">{visibleApps.length}件のアプリが見つかりました。</p>
      <div id="workhub-app-results" role="region" aria-label="アプリ検索結果">
      {visibleApps.length === 0 ? <p className="workhub-empty-state">{apps.length === 0 ? "現在表示できるアプリはありません。" : "条件に一致するアプリはありません。"}</p> :
        <div className="workhub-app-grid">
          {visibleApps.map(app => <article className="workhub-app-card" key={app.key}>
            <span className="workhub-card-label">{app.category}</span>
            <h3>{app.displayName}</h3>
            <p>{app.description}</p>
            <small>{app.sourceSystem}</small>
            {app.availability === "available" && app.launchTarget
              ? <a href={app.launchTarget} className="workhub-app-open" aria-label={`${app.displayName}を開く`}>開く →</a>
              : <span className="workhub-app-unavailable" aria-label={`${app.displayName}は接続準備中`}>接続準備中</span>}
          </article>)}
        </div>}
      </div>
    </>}
    </section>
  </>;
}
