import { useEffect, useState } from "react";
import { WORKHUB_RETIRE_DEMO_ITEM_ID } from "../workhub/travel-request";

const base = "/api/admin/master-operations/retire";
const params = new URLSearchParams({
  scopeId: "workhub-company", itemId: WORKHUB_RETIRE_DEMO_ITEM_ID,
});
interface RetireProjection {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly retiredAt: string | null;
}
interface RetirePreview {
  readonly item: RetireProjection;
  readonly available: boolean;
  readonly reasonCode: string | null;
  readonly policyVersion: string;
  readonly preview: { readonly policyDecision: string; readonly risk: string };
}
type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly preview: RetirePreview }
  | { readonly kind: "error"; readonly requestId: string | null };

export default function MasterRetireDemo() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const refresh = async () => {
    setState({ kind: "loading" });
    try {
      const detailParams = new URLSearchParams({
        scopeId: "workhub-company", masterKey: "workhub.office", itemId: WORKHUB_RETIRE_DEMO_ITEM_ID,
      });
      const detailResponse = await fetch("/api/admin/master-data?" + detailParams.toString());
      if (!detailResponse.ok) {
        setState({ kind: "error", requestId: detailResponse.headers.get("x-request-id") });
        return;
      }
      const detail = await detailResponse.json() as { readonly item: RetireProjection };
      const response = await fetch(base + "/preview?" + params + "&expectedVersion=" + detail.item.version);
      if (!response.ok) {
        setState({ kind: "error", requestId: response.headers.get("x-request-id") });
        return;
      }
      setState({ kind: "ready", preview: await response.json() as RetirePreview });
    } catch {
      setState({ kind: "error", requestId: null });
    }
  };

  const execute = async () => {
    if (state.kind !== "ready" || !state.preview.available || !reason.trim() || !confirmed || busy) return;
    setBusy(true);
    setStatus("");
    try {
      const csrfResponse = await fetch("/api/auth/csrf", { headers: { accept: "application/json" } });
      if (!csrfResponse.ok) throw new Error("csrf_unavailable");
      const { csrfToken } = await csrfResponse.json() as { readonly csrfToken: string };
      const response = await fetch(base + "/execute?" + params, {
        method: "POST",
        headers: {
          "content-type": "application/json", accept: "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          expectedVersion: state.preview.item.version,
          previewPolicyVersion: state.preview.policyVersion,
          reason: reason.trim(), confirmed,
        }),
      });
      if (response.status === 409) {
        setStatus("他の操作で状態が変わりました。再取得した内容を確認してください");
        setConfirmed(false);
        await refresh();
        return;
      }
      if (!response.ok) {
        setStatus("廃止処理を確認できませんでした。HTTP " + response.status + " / Request ID: " +
          (response.headers.get("x-request-id") ?? "unknown"));
        await refresh();
        return;
      }
      const result = await response.json() as {
        readonly execution: { readonly result: string };
        readonly verification: { readonly status: string };
      };
      if (result.execution.result !== "SUCCESS" || result.verification.status !== "PASSED") {
        setStatus("廃止後の状態確認が完了していません。再確認してください");
      } else {
        setStatus("廃止と検証が完了しました");
      }
      setReason("");
      setConfirmed(false);
      await refresh();
    } catch {
      setStatus("処理結果を確認できませんでした。状態を再取得してください");
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  return <section className="admin-audit-panel" id="admin-master-retire-demo" aria-labelledby="admin-retire-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">CONTROLLED MASTER OPERATION / PREVIEW DEMO</p>
        <h2 id="admin-retire-title">拠点マスタ廃止（専用デモ）</h2>
        <p>出張申請では使用しないLEGACY拠点のみが対象です。理由・確認・Versionの一致を必須にし、履歴を削除せず新規選択だけを停止します。</p>
      </div>
    </div>
    {state.kind === "loading" && <div className="admin-audit-state" role="status">廃止対象を確認しています…</div>}
    {state.kind === "error" && <div className="admin-audit-state is-error" role="alert">
      <strong>廃止操作は利用できません</strong>
      <span>Previewデモ専用です。{state.requestId ? "Request ID: " + state.requestId : ""}</span>
    </div>}
    {state.kind === "ready" && <div className="admin-retry-panel">
      <div>
        <p>Command: <strong>RETIRE_MASTER_ITEM</strong></p>
        <p>対象: <strong>{state.preview.item.code}</strong> / Version: <strong>{state.preview.item.version}</strong></p>
        <p>Risk: <strong>{state.preview.preview.risk}</strong> / Policy: <strong>{state.preview.preview.policyDecision}</strong></p>
        <p data-testid="master-retired-state">Retired: <strong>{state.preview.item.retiredAt ? "YES" : "NO"}</strong></p>
      </div>
      {state.preview.available && state.preview.preview.policyDecision === "REQUIRE_REASON"
        ? <form onSubmit={(event) => { event.preventDefault(); void execute(); }}>
            <label>廃止理由
              <textarea value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} required placeholder="例：利用しなくなった拠点コードの選択を終了するため" />
            </label>
            <label className="admin-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />LEGACY拠点・環境・変更の影響を確認しました</label>
            <div className="admin-retry-actions">
              <button type="submit" disabled={busy || !reason.trim() || !confirmed}>デモ拠点を廃止</button>
            </div>
          </form>
        : <p className="admin-audit-note">操作不可: {state.preview.reasonCode ?? state.preview.preview.policyDecision}。履歴はマスタ管理（参照）で引き続き確認できます。</p>}
    </div>}
    {status && <div className="admin-audit-state" role="status">{status}</div>}
  </section>;
}
