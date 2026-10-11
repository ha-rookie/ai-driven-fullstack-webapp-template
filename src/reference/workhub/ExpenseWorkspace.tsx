import { FormEvent, useCallback, useEffect, useState } from "react";
import "./expenses.css";

interface ExpenseLine {
  readonly expenseDate: string;
  readonly category: "TRANSPORT" | "LODGING" | "OTHER";
  readonly description: string;
  readonly amountYen: number;
}
interface ExpenseClaim {
  readonly id: string;
  readonly purpose: string;
  readonly lines: readonly ExpenseLine[];
  readonly totalYen: number;
  readonly status: "submitted" | "returned" | "approved";
  readonly returnReason: string | null;
  readonly version: number;
  readonly travelRequestId: string | null;
}
interface TravelOption {
  readonly id: string;
  readonly purpose: string;
  readonly workflowState: string | null;
}
interface EditLine {
  expenseDate: string;
  category: ExpenseLine["category"];
  description: string;
  amountYen: string;
}
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const blankLine = (): EditLine => ({
  expenseDate: today(), category: "TRANSPORT", description: "", amountYen: "",
});
const categories: Record<ExpenseLine["category"], string> = {
  TRANSPORT: "交通費", LODGING: "宿泊費", OTHER: "その他",
};
const statusText: Record<ExpenseClaim["status"], string> = {
  submitted: "経理確認待ち", returned: "差戻し・要修正", approved: "経理承認済み",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body) headers.set("content-type", "application/json");
  if (init?.method && init.method !== "GET") {
    const csrfResponse = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    if (!csrfResponse.ok) throw new Error("CSRF token unavailable");
    const csrf = await csrfResponse.json() as { csrfToken: string };
    headers.set("x-csrf-token", csrf.csrfToken);
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? `通信エラー（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

/** The reference expense domain is separate from the travel workflow domain. */
export default function ExpenseWorkspace({ principalId }: { readonly principalId: string }) {
  const isEmployee = principalId === "workhub-demo-aoi";
  const isAccountant = principalId === "workhub-demo-mei";
  const [claims, setClaims] = useState<ExpenseClaim[]>([]);
  const [travels, setTravels] = useState<TravelOption[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [travelRequestId, setTravelRequestId] = useState("");
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setListState("loading");
    try {
      const result = await request<{ items: ExpenseClaim[] }>("/api/workhub/expenses");
      setClaims(result.items);
      setListState("ready");
    } catch {
      setListState("error");
    }
  }, []);

  useEffect(() => {
    if (!isEmployee && !isAccountant) return;
    void refresh();
    if (isEmployee) {
      void request<{ items: TravelOption[] }>("/api/workhub/travel-requests")
        .then(response => setTravels(response.items.filter(item => item.workflowState === "completed")))
        .catch(() => setTravels([]));
    }
  }, [isEmployee, isAccountant, refresh]);

  if (!isEmployee && !isAccountant) return null;

  const updateLine = (index: number, patch: Partial<EditLine>) => {
    setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  };

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try { await operation(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "処理に失敗しました"); }
    finally { setBusy(false); }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const payload = {
        purpose,
        travelRequestId: travelRequestId || null,
        lines: lines.map(line => ({ ...line, amountYen: Number(line.amountYen) })),
        ...(editing ? { expectedVersion: editing.version } : {}),
      };
      const path = editing ? `/api/workhub/expenses/${encodeURIComponent(editing.id)}` : "/api/workhub/expenses";
      await request(path, { method: editing ? "PUT" : "POST", body: JSON.stringify(payload) });
      setPurpose("");
      setLines([blankLine()]);
      setTravelRequestId("");
      setEditing(null);
      await refresh();
      setMessage(editing ? "経費精算を修正して再提出しました。" : "経費精算を提出しました。");
    });
  };

  const editReturned = (claim: ExpenseClaim) => {
    setPurpose(claim.purpose);
    setLines(claim.lines.map(line => ({ ...line, amountYen: String(line.amountYen) })));
    setTravelRequestId(claim.travelRequestId ?? "");
    setEditing({ id: claim.id, version: claim.version });
    requestAnimationFrame(() => document.getElementById("workhub-expense-purpose")?.focus());
  };

  const decide = (claim: ExpenseClaim, action: "approve" | "return") => {
    const reason = reviewReasons[claim.id]?.trim() ?? "";
    if (action === "return" && !reason) {
      setMessage("差戻し理由を入力してください。");
      return;
    }
    void run(async () => {
      await request(`/api/workhub/expenses/${encodeURIComponent(claim.id)}/decision`, {
        method: "POST",
        body: JSON.stringify({ action, reason, expectedVersion: claim.version }),
      });
      await refresh();
      setMessage(action === "approve" ? "経費精算を承認しました。" : "経費精算を差し戻しました。");
    });
  };

  return <section className="workhub-expenses" id="workhub-expenses" aria-labelledby="workhub-expenses-title">
    <div className="workhub-section-heading">
      <div><span className="workhub-card-label">EXPENSE SETTLEMENT</span><h2 id="workhub-expenses-title">交通費・経費精算</h2></div>
      <button className="workhub-secondary-button" type="button" disabled={listState === "loading"} onClick={() => void refresh()}>精算一覧を更新</button>
    </div>
    <p className="workhub-expense-description">社員は費用の明細を登録、経理は内容を確認して承認・差戻しします。実際の支払や会計仕訳は行いません。</p>
    {message && <p role="status" className="workhub-expense-message">{message}</p>}
    {isEmployee && <form className="workhub-expense-form" onSubmit={submit} aria-label="交通費・経費精算を申請">
      <h3>{editing ? "差戻された精算を修正" : "新しい経費精算を申請"}</h3>
      <label>精算の目的<input id="workhub-expense-purpose" aria-label="精算の目的" required maxLength={200} value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
      <label>承認済みの出張申請（任意）<select aria-label="紐づける出張申請" value={travelRequestId} onChange={event => setTravelRequestId(event.target.value)}>
        <option value="">紐づけなし</option>{travels.map(trip => <option key={trip.id} value={trip.id}>{trip.purpose}</option>)}
      </select></label>
      <div className="workhub-expense-lines">
        <h4>経費明細（最大5行）</h4>
        {lines.map((line, index) => <div className="workhub-expense-line" key={index}>
          <label>利用日<input type="date" aria-label={`明細${index + 1}の利用日`} required value={line.expenseDate} onChange={event => updateLine(index, { expenseDate: event.target.value })} /></label>
          <label>費目<select aria-label={`明細${index + 1}の費目`} value={line.category} onChange={event => updateLine(index, { category: event.target.value as ExpenseLine["category"] })}>
            {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label>内容<input aria-label={`明細${index + 1}の内容`} required maxLength={200} value={line.description} onChange={event => updateLine(index, { description: event.target.value })} /></label>
          <label>金額（円）<input type="number" aria-label={`明細${index + 1}の金額`} required min={1} max={1000000} step={1} value={line.amountYen} onChange={event => updateLine(index, { amountYen: event.target.value })} /></label>
          {lines.length > 1 && <button className="workhub-secondary-button" type="button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>この明細を削除</button>}
        </div>)}
        {lines.length < 5 && <button className="workhub-secondary-button" type="button" onClick={() => setLines(current => [...current, blankLine()])}>明細を追加</button>}
      </div>
      <p className="workhub-expense-total">入力合計（確認用）：{lines.reduce((sum, line) => sum + (Number(line.amountYen) || 0), 0).toLocaleString("ja-JP")}円 <small>確定金額は送信時にサーバーで計算</small></p>
      <button className="workhub-primary-button" type="submit" disabled={busy}>{editing ? "経費精算を再提出" : "経費精算を提出"}</button>
      {editing && <button type="button" className="workhub-secondary-button" onClick={() => { setEditing(null); setPurpose(""); setLines([blankLine()]); setTravelRequestId(""); }}>修正をやめる</button>}
    </form>}
    {listState === "loading" ? <p role="status">精算一覧を読み込んでいます…</p> :
      listState === "error" ? <div role="alert">精算一覧を取得できませんでした。<button type="button" className="workhub-secondary-button" onClick={() => void refresh()}>再読み込み</button></div> :
        claims.length === 0 ? <p className="workhub-empty-state">経費精算はまだありません。</p> :
          <div className="workhub-expense-list" aria-label={isAccountant ? "経理の精算確認一覧" : "自分の経費精算一覧"}>
            {claims.map(claim => <article className="workhub-expense-item" key={claim.id}>
              <h3>{claim.purpose}</h3>
              <span className="workhub-expense-status">{statusText[claim.status]}</span>
              <strong>合計 {claim.totalYen.toLocaleString("ja-JP")}円</strong>
              <ul>{claim.lines.map((line, index) =>
                <li key={index}>{line.expenseDate}・{categories[line.category]}・{line.description}：{line.amountYen.toLocaleString("ja-JP")}円</li>)}</ul>
              {claim.returnReason && claim.status === "returned" && <p className="workhub-expense-return-reason">差戻し理由：{claim.returnReason}</p>}
              {isEmployee && claim.status === "returned" && <button type="button" className="workhub-secondary-button" disabled={busy} onClick={() => editReturned(claim)}>この精算を修正</button>}
              {isAccountant && claim.status === "submitted" && <div className="workhub-expense-review">
                <label>差戻し理由<textarea aria-label={`${claim.purpose}の差戻し理由`} maxLength={500} rows={2} value={reviewReasons[claim.id] ?? ""} onChange={event => setReviewReasons(current => ({ ...current, [claim.id]: event.target.value }))} /></label>
                <div className="workhub-inline-actions">
                  <button className="workhub-secondary-button" type="button" disabled={busy} onClick={() => decide(claim, "return")}>経費を差し戻す</button>
                  <button className="workhub-primary-button" type="button" disabled={busy} onClick={() => decide(claim, "approve")}>経費を承認する</button>
                </div>
              </div>}
            </article>)}
          </div>}
    <small className="workhub-reference-note">Reference用の経費精算です。法定帳簿、税額、領収書添付、支払実行は対象外です。</small>
  </section>;
}
