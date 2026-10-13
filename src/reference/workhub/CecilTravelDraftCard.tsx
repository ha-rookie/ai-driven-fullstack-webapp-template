import { useEffect, useState } from "react";
import {
  isAuthorizedCecilTravelApp, validateCecilTravelDraft,
  type CecilTravelDraft, type CecilTravelOffice,
} from "./travel-draft";

interface Props {
  readonly onCancel: () => void;
  readonly onHandoff: (draft: CecilTravelDraft) => boolean;
}
type State = "loading" | "ready" | "denied" | "error" | "checking";

const getJson = async (path: string, signal?: AbortSignal): Promise<unknown> => {
  const response = await fetch(path, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "same-origin", cache: "no-store", signal,
  });
  if (!response.ok) throw new Error("unavailable");
  return response.json() as Promise<unknown>;
};

/**
 * Reference L2 never calls POST or writes Business State.
 * Check existing role-filtered app catalog and offices before showing fields,
 * then read them again before handing user-confirmed values to the real form.
 */
export default function CecilTravelDraftCard({ onCancel, onHandoff }: Props) {
  const [state, setState] = useState<State>("loading");
  const [offices, setOffices] = useState<readonly CecilTravelOffice[]>([]);
  const [draft, setDraft] = useState<CecilTravelDraft>({
    destinationOfficeItemId: "", startDate: "", endDate: "", purpose: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [appsPayload, officePayload] = await Promise.all([
          getJson("/api/workhub/apps", controller.signal),
          getJson("/api/workhub/offices", controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const apps = (appsPayload as { items?: unknown } | null)?.items;
        if (!isAuthorizedCecilTravelApp(apps)) {
          setState("denied");
          return;
        }
        const items = (officePayload as { items?: unknown } | null)?.items;
        if (!Array.isArray(items)) throw new Error("invalid_offices");
        const valid = items.filter((x): x is CecilTravelOffice =>
          x && typeof x.itemId === "string" && typeof x.label === "string" && typeof x.code === "string");
        setOffices(valid);
        setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const update = (field: keyof CecilTravelDraft, value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    setError(null);
  };
  const handoff = async () => {
    const failure = validateCecilTravelDraft(draft, offices);
    if (failure) { setError(failure); return; }
    setState("checking");
    setError(null);
    try {
      const [appsPayload, officePayload] = await Promise.all([
        getJson("/api/workhub/apps"), getJson("/api/workhub/offices"),
      ]);
      if (!isAuthorizedCecilTravelApp((appsPayload as { items?: unknown } | null)?.items)) {
        setState("denied");
        return;
      }
      const refreshed = (officePayload as { items?: unknown } | null)?.items;
      if (!Array.isArray(refreshed)) throw new Error("invalid_offices");
      const allowedOffices = refreshed.filter((x): x is CecilTravelOffice =>
        x && typeof x.itemId === "string" && typeof x.label === "string" && typeof x.code === "string");
      const changed = validateCecilTravelDraft(draft, allowedOffices);
      if (changed) {
        setState("ready");
        setError("選択できる出張先が変わりました。内容を確認し直してください。");
        setOffices(allowedOffices);
        return;
      }
      if (!onHandoff({ ...draft, purpose: draft.purpose.trim() })) {
        setError("すでに編集中の申請があります。既存の申請内容を先に確認してください。");
        setState("ready");
      }
    } catch {
      setState("error");
    }
  };

  return <section className="workhub-ask-draft-card" aria-label="出張申請の下書き">
    <div className="workhub-ask-draft-title">
      <div><span className="workhub-card-label">L2 / DRAFT READY</span><h3>出張申請の下書き</h3></div>
      <button type="button" className="workhub-secondary-button" onClick={onCancel}>案内に戻る</button>
    </div>
    <p>入力内容を申請フォームに引き渡すだけです。<strong>保存・提出・承認依頼は行いません。</strong></p>
    {state === "loading" && <p role="status">利用できる申請と行先を確認しています…</p>}
    {state === "denied" && <p role="alert">現在の権限では出張申請の下書きを準備できません。申請・手続き一覧を確認してください。</p>}
    {state === "error" && <div role="alert">
      <p>現在の出張申請情報を確認できません。推測で入力せず、通常の申請画面から確認してください。</p>
      <button type="button" className="workhub-secondary-button" onClick={onCancel}>案内に戻る</button>
    </div>}
    {(state === "ready" || state === "checking") && <>
      <div className="workhub-ask-draft-fields">
        <label>出張先
          <select aria-label="下書きの出張先" value={draft.destinationOfficeItemId} disabled={state === "checking"}
            onChange={e => update("destinationOfficeItemId", e.target.value)}>
            <option value="">出張先を選択</option>
            {offices.map(o => <option key={o.itemId} value={o.itemId}>{o.label} ({o.code})</option>)}
          </select>
        </label>
        <label>開始日<input aria-label="下書きの開始日" type="date" value={draft.startDate}
          disabled={state === "checking"} onChange={e => update("startDate", e.target.value)} /></label>
        <label>終了日<input aria-label="下書きの終了日" type="date" value={draft.endDate}
          disabled={state === "checking"} onChange={e => update("endDate", e.target.value)} /></label>
        <label>目的<textarea aria-label="下書きの目的" value={draft.purpose} maxLength={2000} rows={3}
          disabled={state === "checking"} onChange={e => update("purpose", e.target.value)} /></label>
      </div>
      {error && <p role="alert" className="workhub-ask-warning">{error}</p>}
      <div className="workhub-ask-draft-actions">
        <button type="button" className="workhub-primary-button" disabled={state === "checking" || !offices.length} onClick={() => void handoff()}>
          {state === "checking" ? "権限・行先を再確認中…" : "申請画面で確認する"}
        </button>
      </div>
      <small>実際の提出は、引き渡し後に本来の出張申請画面で本人が判断します。</small>
    </>}
  </section>;
}
