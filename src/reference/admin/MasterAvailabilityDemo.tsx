import { useEffect, useState } from "react";
import { MasterFutureDateField, MasterOperationConfirmationFields } from "./MasterOperationFormFields";
import {
  WORKHUB_AVAILABILITY_DISABLE_ITEM_ID,
  WORKHUB_AVAILABILITY_ENABLE_ITEM_ID,
} from "../workhub/travel-request";

const TARGETS = [
  { id: WORKHUB_AVAILABILITY_DISABLE_ITEM_ID, enabled: false, label: "有効 → 将来無効" },
  { id: WORKHUB_AVAILABILITY_ENABLE_ITEM_ID, enabled: true, label: "無効 → 将来有効" },
] as const;
const BASE = "/api/admin/master-operations/schedule";
const SCOPE = "workhub-company";
const CUTOFF = "2027-04-01T00:00:00.000Z";

interface MasterDetail {
  item: { readonly id: string; readonly code: string; readonly version: number; readonly retiredAt: string | null };
  revisions: readonly {
    readonly id: string; readonly label: string; readonly enabled: boolean;
    readonly effectiveFrom: string; readonly effectiveTo: string | null;
    readonly lifecycle: string;
  }[];
}
interface MasterPreview {
  readonly available: boolean;
  readonly priorRevisionId: string | null;
  readonly policyVersion: string;
  readonly enabled: boolean;
  readonly currentEnabled: boolean | null;
  readonly reasonCode: string | null;
  readonly preview: { readonly policyDecision: string; readonly risk: string };
}

export default function MasterAvailabilityDemo({ requestedItemId }: { readonly requestedItemId?: string | null }) {
  const [itemId, setItemId] = useState<string>(TARGETS[0].id);
  const [detail, setDetail] = useState<MasterDetail | null>(null);
  const [preview, setPreview] = useState<MasterPreview | null>(null);
  const [cutover, setCutover] = useState(CUTOFF);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const target = TARGETS.find((candidate) => candidate.id === itemId) ?? TARGETS[0];

  const query = () => new URLSearchParams({ scopeId: SCOPE, itemId });
  const reload = async () => {
    setStatus("loading");
    setPreview(null);
    try {
      const q = new URLSearchParams({ ...Object.fromEntries(query()), masterKey: "workhub.office" });
      const response = await fetch("/api/admin/master-data?" + q);
      if (!response.ok) throw new Error("viewer_unavailable");
      setDetail(await response.json() as MasterDetail);
      setStatus("ready");
    } catch {
      setDetail(null);
      setStatus("error");
    }
  };
  useEffect(() => {
    if (requestedItemId && TARGETS.some((candidate) => candidate.id === requestedItemId)) {
      setItemId(requestedItemId);
      setPreview(null);
      setReason("");
      setConfirmed(false);
    }
  }, [requestedItemId]);
  useEffect(() => { void reload(); }, [itemId]);
  const current = detail?.revisions.find((revision) =>
    revision.lifecycle === "current" || revision.lifecycle === "disabled",
  );
  const inspect = async () => {
    if (!detail || !current || busy) return;
    setBusy(true);
    setPreview(null);
    setMessage("");
    setConfirmed(false);
    try {
      const q = query();
      q.set("expectedVersion", String(detail.item.version));
      q.set("label", current.label);
      q.set("enabled", String(target.enabled));
      q.set("effectiveFrom", cutover);
      const response = await fetch(BASE + "/preview?" + q);
      if (!response.ok) throw new Error("preview_failed");
      setPreview(await response.json() as MasterPreview);
    } catch {
      setMessage("下見に失敗しました。日時と権限を確認してください");
    } finally {
      setBusy(false);
    }
  };
  const execute = async () => {
    if (!detail || !current || !preview?.available || !preview.priorRevisionId
      || preview.enabled !== target.enabled || !confirmed || !reason.trim() || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const csrfResponse = await fetch("/api/auth/csrf");
      if (!csrfResponse.ok) throw new Error("csrf_failed");
      const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
      const response = await fetch(BASE + "/execute?" + query(), {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          expectedVersion: detail.item.version,
          priorRevisionId: preview.priorRevisionId,
          label: current.label,
          enabled: target.enabled,
          effectiveFrom: cutover,
          reason: reason.trim(), confirmed,
          previewPolicyVersion: preview.policyVersion,
        }),
      });
      const outcome = await response.json() as {
        execution?: { result: string };
        verification?: { status: string };
      };
      setMessage(response.ok && outcome.execution?.result === "SUCCESS"
        && outcome.verification?.status === "PASSED"
        ? "状態変更を予約し、履歴と永続監査を検証しました"
        : "予約できませんでした。最新の履歴を確認してください（HTTP " + response.status + "）");
      if (response.ok) { setReason(""); setConfirmed(false); }
      await reload();
    } catch {
      setMessage("予約結果を確認できません。履歴と監査を確認してください");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return <section className="admin-audit-panel" id="admin-master-availability" aria-labelledby="master-availability-title">
    <div className="admin-audit-heading"><div>
      <p className="admin-eyebrow">AVAILABILITY / PREVIEW DEMO</p>
      <h2 id="master-availability-title">マスタ有効・無効の将来予約</h2>
      <p>専用の拠点デモのみ。無効化は新規選択から外す操作で、廃止や物理削除とは異なります。過去のRevisionは保持します。</p>
    </div></div>
    <div className="admin-retry-panel">
      <label>対象デモ
        <select value={itemId} onChange={(event) => {
          setItemId(event.target.value); setPreview(null); setReason(""); setConfirmed(false);
        }}>
          {TARGETS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      {status === "loading" && <p role="status">デモの状態を取得しています…</p>}
      {status === "error" && <p role="alert">マスタを取得できませんでした</p>}
      {status === "ready" && detail && <div>
        <p>対象：<strong>{detail.item.code}</strong> / Item Version：{detail.item.version}</p>
        <p data-testid="master-availability-history">Revision：{detail.revisions.length} 件</p>
        <div className="admin-audit-table-wrap">
          <table className="admin-audit-table">
            <thead><tr><th>名称</th><th>enabled</th><th>開始 UTC</th><th>終了 UTC</th><th>状態</th></tr></thead>
            <tbody>{detail.revisions.map((revision) => <tr key={revision.id}>
              <td>{revision.label}</td><td>{String(revision.enabled)}</td>
              <td>{revision.effectiveFrom}</td><td>{revision.effectiveTo ?? "open-ended"}</td>
              <td>{revision.lifecycle}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <MasterFutureDateField label="切替開始日時（ISO UTC）" value={cutover}
          placeholder={CUTOFF} onChange={(value) => { setCutover(value); setPreview(null); }} />
        <button type="button" onClick={() => { void inspect(); }} disabled={busy || !current}>状態変更を下見</button>
        {preview && <div className="admin-retry-panel">
          <p data-testid="master-availability-preview">
            {String(preview.currentEnabled)} → {String(preview.enabled)} ／
            Risk: {preview.preview.risk} ／ Policy: {preview.preview.policyDecision}
          </p>
          {preview.available && preview.preview.policyDecision === "REQUIRE_REASON"
            ? <form onSubmit={(event) => { event.preventDefault(); void execute(); }}>
                <MasterOperationConfirmationFields
                  reason={reason} onReasonChange={setReason} reasonLabel="状態変更の理由"
                  confirmed={confirmed} onConfirmChange={setConfirmed}
                  confirmationLabel="新規選択への影響、切替日時、過去履歴の保持を確認しました"
                  busy={busy} submitLabel="状態変更を予約" />
              </form>
            : <p>この状態変更は予約できません：{preview.reasonCode ?? "現在の状態を確認してください"}</p>}
        </div>}
      </div>}
      {message && <p role="status">{message}</p>}
    </div>
  </section>;
}
