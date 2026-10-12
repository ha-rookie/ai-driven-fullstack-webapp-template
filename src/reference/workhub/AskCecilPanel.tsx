import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  createCecilGuide,
  type CecilDocument,
  type CecilGuide,
  type CecilSearchResult,
} from "./ask-cecil";
import "./ask-cecil.css";

interface AskCecilPanelProps {
  readonly onClose: () => void;
}

const SUGGESTIONS = ["出張", "経費", "入社", "ナレッジ"] as const;
type LookupState = "idle" | "loading" | "ready" | "error";

/**
 * The Reference concierge is intentionally retrieval-only in Increment 1.
 * It shares the existing authenticated server APIs with WORKHUB Search;
 * it does not run LLM tools, trust client roles or mutate business records.
 */
export default function AskCecilPanel({ onClose }: AskCecilPanelProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LookupState>("idle");
  const [guide, setGuide] = useState<CecilGuide | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      ++requestVersion.current;
      requestRef.current?.abort();
    };
  }, []);

  // Async result replacement may remove the focused Retry button and send
  // keyboard focus to <body>. Escape must still close the dialog in that state.
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const candidates = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href]'
    );
    if (!candidates?.length) return;
    const first = candidates[0];
    const last = candidates[candidates.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const lookup = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 100) {
      setErrorMessage("質問は1〜100文字で入力してください。");
      setState("error");
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const version = ++requestVersion.current;
    setQuery(trimmed);
    setState("loading");
    setGuide(null);
    setWarning(null);
    setErrorMessage(null);
    try {
      const fetchOptions: RequestInit = {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      };
      const [search, documents] = await Promise.all([
        fetch("/api/workhub/search?q=" + encodeURIComponent(trimmed) + "&category=all", fetchOptions),
        fetch("/api/workhub/documents", fetchOptions),
      ]);
      if (!search.ok) throw new Error("search_unavailable");
      const searchBody: unknown = await search.json();
      const resultItems = (searchBody as { results?: unknown } | null)?.results;
      if (!Array.isArray(resultItems)) throw new Error("search_invalid_result");
      let docItems: CecilDocument[] = [];
      let docWarning: string | null = null;
      if (documents.ok) {
        const docsBody: unknown = await documents.json();
        const items = (docsBody as { items?: unknown } | null)?.items;
        if (!Array.isArray(items)) throw new Error("document_invalid_result");
        docItems = items as CecilDocument[];
      } else {
        // Retain authorized navigation candidates but never assert an L0 answer.
        docWarning = "文書の根拠を確認できませんでした。候補は確認できますが、正式な回答はできません。";
      }
      if (version !== requestVersion.current || controller.signal.aborted) return;
      setGuide(createCecilGuide(resultItems as CecilSearchResult[], docItems));
      setWarning(docWarning);
      setState("ready");
    } catch {
      if (version !== requestVersion.current || controller.signal.aborted) return;
      setGuide(null);
      setErrorMessage("検索に失敗しました。結果が0件とは限りません。通常検索も利用できます。");
      setState("error");
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void lookup(query);
  };

  return (
    <div className="workhub-ask-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="workhub-ask-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workhub-ask-title"
        onKeyDown={onPanelKeyDown}
      >
        <header className="workhub-ask-heading">
          <div>
            <p className="workhub-card-label">WORKHUB / REFERENCE</p>
            <h2 id="workhub-ask-title">Ask CECIL</h2>
            <p>社内の資料や申請先を、根拠から探します。</p>
          </div>
          <button type="button" className="workhub-secondary-button" onClick={onClose} aria-label="Ask CECILを閉じる">閉じる</button>
        </header>
        <div className="workhub-ask-scroll">
          <p className="workhub-ask-disclaimer">
            現在は参照情報による案内（L0・L1）です。AI生成の規程回答や申請の自動実行はしません。
          </p>
          <div className="workhub-ask-prompts" aria-label="質問例">
            {SUGGESTIONS.map(item => (
              <button key={item} type="button" onClick={() => void lookup(item)} disabled={state === "loading"}>{item}について</button>
            ))}
          </div>
          {state === "loading" && <p role="status">現在の閲覧権限で資料を確認しています…</p>}
          {state === "error" && <div className="workhub-ask-warning" role="alert">
            <p>{errorMessage}</p>
            <button className="workhub-secondary-button" type="button" onClick={() => void lookup(query)}>再試行</button>
          </div>}
          {state === "ready" && guide && (
            <div className="workhub-ask-result" aria-live="polite">
              <div className="workhub-ask-summary">
                <span className="workhub-card-label">
                  {guide.status === "answer" ? "L0 / 確認済みの資料" : "L1 / 検索・案内"}
                </span>
                <p>{guide.summary}</p>
              </div>
              {warning && <p className="workhub-ask-warning" role="status">{warning}</p>}
              {guide.evidence.length > 0 && (
                <section aria-label="根拠となる文書" className="workhub-ask-evidence">
                  <h3>根拠・出典</h3>
                  <ul>{guide.evidence.map(item => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.category} / v{item.version} / {item.freshness === "current" ? "現行" : item.freshness === "stale" ? "要再確認" : "旧版"}</span>
                      <span>管理: {item.ownerLabel} / 最終確認: {item.reviewedAt}</span>
                      {item.url && <a href={item.url} onClick={onClose}>この文書を開く</a>}
                    </li>
                  ))}</ul>
                </section>
              )}
              {guide.destinations.length > 0 && (
                <section aria-label="関連する移動先" className="workhub-ask-destinations">
                  <h3>次に確認できること</h3>
                  <ul>{guide.destinations.map(item => (
                    <li key={item.key}>{item.url
                      ? <a href={item.url} onClick={onClose}>{item.title}</a>
                      : <span>{item.title}（直接移動不可）</span>}</li>
                  ))}</ul>
                </section>
              )}
              {guide.status === "insufficient" && <a href="#workhub-documents" onClick={onClose}>ナレッジ一覧から探す</a>}
            </div>
          )}
        </div>
        <form className="workhub-ask-form" onSubmit={submit} role="search">
          <label htmlFor="workhub-ask-query">質問・探していること</label>
          <div className="workhub-ask-input-row">
            <input
              ref={inputRef}
              id="workhub-ask-query"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例: 出張について"
            />
            <button className="workhub-primary-button" disabled={!query.trim() || state === "loading"} type="submit">探す</button>
          </div>
          <small>回答は現在アクセス可能なデモ資料の要約です。実際の就業規則の代わりにはなりません。</small>
        </form>
      </section>
    </div>
  );
}
