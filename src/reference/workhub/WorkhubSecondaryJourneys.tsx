import { useCallback, useEffect, useRef, useState } from "react";
import type { SecondaryJourneyView, SecondaryIntent } from "./secondary-journeys";
import "./secondary-journeys.css";

type LoadState = "loading" | "ready" | "error";

const readJourneys = async (): Promise<readonly SecondaryJourneyView[]> => {
  const response = await fetch("/api/workhub/secondary-journeys", {
    credentials: "same-origin", headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("secondary_journey_read_failure");
  const data = await response.json() as { items: SecondaryJourneyView[] };
  if (!Array.isArray(data.items)) throw new Error("secondary_journey_invalid_response");
  return data.items;
};

const mutate = async (
  path: string, payload: Record<string, unknown>,
): Promise<void> => {
  const token = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  if (!token.ok) throw new Error("csrf_unavailable");
  const { csrfToken } = await token.json() as { csrfToken: string };
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
};

/**
 * WORKHUB Reference-only checklist. The Workflow Foundation persists its
 * synthetic steps; no real address, commute route or device asset is changed.
 */
export default function WorkhubSecondaryJourneys({ role }: {
  readonly role: "employee" | "corporate";
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<readonly SecondaryJourneyView[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const pendingStart = useRef<{ readonly key: string; readonly intent: SecondaryIntent } | null>(null);

  const refresh = useCallback(() => { setState("loading"); setReload(value => value + 1); }, []);
  useEffect(() => {
    let alive = true;
    setState("loading");
    void readJourneys().then(result => {
      if (!alive) return;
      setItems(result);
      setState("ready");
      if (pendingStart.current && result.some(x => x.submissionKey.endsWith(pendingStart.current!.key))) {
        pendingStart.current = null;
      }
    }).catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [reload]);

  const perform = async (action: () => Promise<void>) => {
    if (inFlight.current || state !== "ready") return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
      refresh();
    } catch (caught) {
      const status = caught instanceof Error ? caught.message : "";
      setMessage(status === "HTTP 409"
        ? "手続きの状態が変更されています。再送信せず「最新状態を確認」で状態を確認してください。"
        : status === "HTTP 403" || status === "HTTP 404"
          ? "現在の担当権限では操作できません。最新状態を確認してください。"
          : "処理結果を確認できません。再送信せず「最新状態を確認」で確認してください。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const begin = (intent: SecondaryIntent) => {
    if (pendingStart.current) {
      setMessage("直前の依頼結果が未確認です。まず「最新状態を確認」を押してください。");
      return;
    }
    const key = crypto.randomUUID();
    pendingStart.current = { intent, key };
    void perform(async () => {
      await mutate("/api/workhub/secondary-journeys", { intent, key });
    });
  };
  const retryPendingStart = () => {
    const pending = pendingStart.current;
    if (!pending) return;
    // Never generate a second idempotency key for the same uncertain start.
    // The server returns the previous owner-scoped instance if already committed.
    void perform(async () => {
      await mutate("/api/workhub/secondary-journeys", pending);
    });
  };

  const advance = (item: SecondaryJourneyView) => {
    if (item.workItemVersion === null) return;
    void perform(async () => {
      await mutate(`/api/workhub/secondary-journeys/${encodeURIComponent(item.id)}/advance`, {
        expectedVersion: item.version,
        expectedWorkItemVersion: item.workItemVersion,
      });
    });
  };

  return <section className="workhub-secondary-journeys" id="workhub-secondary-journeys" tabIndex={-1}
    aria-labelledby="workhub-secondary-journeys-title">
    <div className="workhub-section-heading">
      <div><span className="workhub-card-label">SECONDARY JOURNEY / MOCK WORKFLOW</span>
        <h2 id="workhub-secondary-journeys-title">手続きの進捗デモ</h2></div>
      <button className="workhub-secondary-button" type="button" onClick={refresh} disabled={busy}>
        最新状態を確認
      </button>
    </div>
    <p className="workhub-reference-note">
      操作と進捗はデモ環境のWorkflowに保存されます。実際の住所・通勤経路・緊急連絡先・PC資産は変更されません。
      各ステップの「デモ完了」は実業務の受付・実施証明ではありません。
    </p>
    {role === "employee" && <div className="workhub-secondary-actions">
      <button type="button" className="workhub-secondary-button" onClick={() => begin("moving")}
        disabled={busy || state !== "ready" || !!pendingStart.current}>引っ越し手続きをデモ開始</button>
      <button type="button" className="workhub-secondary-button" onClick={() => begin("pc-replacement")}
        disabled={busy || state !== "ready" || !!pendingStart.current}>PC交換をデモ依頼</button>
    </div>}
    {message && <p role="alert" className="workhub-secondary-feedback">{message}</p>}
    {pendingStart.current && message && <button className="workhub-secondary-button" type="button" disabled={busy || state !== "ready"} onClick={retryPendingStart}>同じ依頼を安全に再確認・再試行</button>}
    {state === "loading" && <p role="status">デモの進捗を確認中…</p>}
    {state === "error" && <p role="alert">進捗を取得できませんでした。未着手とは限りません。</p>}
    {state === "ready" && (items.length === 0
      ? <p className="workhub-empty-state">現在確認できるデモ手続きはありません。</p>
      : <div className="workhub-secondary-grid">
        {items.map(item => {
          const current = item.steps.find(step => step.status === "current");
          return <article key={item.id} className="workhub-secondary-item">
            <h3>{item.title}</h3>
            <p aria-live="polite">{item.state === "completed" ? "デモ完了" : "デモ進行中"}
              {" · "}{item.steps.filter(step => step.status === "done").length}/{item.steps.length}ステップ</p>
            <ol aria-label={`${item.title}の手続き進捗`}>{item.steps.map(step => <li key={step.key}>
              <span>{step.status === "done" ? "完了" : step.status === "current" ? "対応中" : "未着手"}</span>
              {" "}{step.label}
            </li>)}</ol>
            {current && <p>次の確認：{current.label}</p>}
            {item.assignedToMe && item.state !== "completed" && <button
              type="button" className="workhub-secondary-button" disabled={busy || state !== "ready"}
              onClick={() => advance(item)}>現在のデモステップを完了する</button>}
            {!item.assignedToMe && item.state !== "completed" && <p>現在の担当者による確認待ち</p>}
          </article>;
        })}
      </div>)}
  </section>;
}
