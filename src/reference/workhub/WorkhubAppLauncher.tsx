import { useEffect, useMemo, useState } from "react";
import type { WorkhubAppEntry } from "./app-catalog";

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

  const categories = useMemo(() => Array.from(new Set(apps.map(app => app.category))), [apps]);
  const visibleApps = useMemo(() => apps.filter(app =>
    (category === "all" || app.category === category)
    && (query.trim() === "" || [app.displayName, app.description, app.category]
      .some(value => value.toLocaleLowerCase("ja-JP").includes(query.trim().toLocaleLowerCase("ja-JP")))),
  ), [apps, category, query]);

  return <section className="workhub-app-launcher" id="workhub-apps" aria-labelledby="workhub-apps-title">
    <div className="workhub-section-heading">
      <div><span className="workhub-card-label">APPS / APP LAUNCHER</span><h2 id="workhub-apps-title">アプリを探す</h2></div>
    </div>
    <p className="workhub-reference-note">現在のアクセス権限で利用できる社内アプリを表示します。未接続のアプリは起動できません。</p>
    {state === "loading" && <p role="status">アプリ一覧を読み込んでいます…</p>}
    {state === "forbidden" && <p role="alert">現在の所属・権限ではアプリ一覧を表示できません。</p>}
    {state === "unavailable" && <div role="alert"><p>アプリ一覧を取得できませんでした。アプリが0件とは限りません。</p><button type="button" className="workhub-secondary-button" onClick={() => setRefresh(value => value + 1)}>再読み込み</button></div>}
    {state === "ready" && <>
      <div className="workhub-app-filters">
        <label>アプリを検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="アプリ名・業務から探す" /></label>
        <label>カテゴリ<select value={category} onChange={event => setCategory(event.target.value)}><option value="all">すべて</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
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
    </>}
  </section>;
}
