import { useEffect, useRef, useState } from "react";
import { classifyMasterOperationOutcome, masterOperationRecoveryMessage, type MasterOperationReceipt } from "./master-operation-outcome";
import { MasterFutureDateField, MasterOperationConfirmationFields } from "./MasterOperationFormFields";
import type { MasterAvailabilityTarget } from "./master-admin-operation-config";
import { classifyMasterPreviewReadiness, masterPreviewReadinessMessage, type MasterPreviewReadiness } from "./master-preview-readiness";
const BASE = "/api/admin/master-operations/schedule";
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

export default function MasterAvailabilityDemo({ requestedItemId, targets }: {
  readonly requestedItemId?: string | null;
  readonly targets: readonly [MasterAvailabilityTarget, ...MasterAvailabilityTarget[]];
}) {
  const [itemId, setItemId] = useState<string>(targets[0].itemId);
  const [detail, setDetail] = useState<MasterDetail | null>(null);
  const [preview, setPreview] = useState<MasterPreview | null>(null);
  const [previewReadiness, setPreviewReadiness] = useState<MasterPreviewReadiness | null>(null);
  const [cutover, setCutover] = useState(CUTOFF);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const previewGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const invalidatePreview = () => {
    ++previewGeneration.current;
    setPreview(null);
    setPreviewReadiness(null);
    setConfirmed(false);
  };
  const target = targets.find((candidate) => candidate.itemId === itemId) ?? targets[0];

  const query = () => new URLSearchParams({ scopeId: target.scopeId, itemId });
  const reload = async () => {
    const generation = ++loadGeneration.current;
    invalidatePreview();
    setDetail(null);
    setStatus("loading");
    try {
      const q = new URLSearchParams({ ...Object.fromEntries(query()), masterKey: target.masterKey });
      const response = await fetch("/api/admin/master-data?" + q);
      if (!response.ok) throw new Error("viewer_unavailable");
      const result = await response.json() as MasterDetail;
      if (generation === loadGeneration.current) {
        setDetail(result);
        setStatus("ready");
      }
    } catch {
      if (generation === loadGeneration.current) {
        setDetail(null);
        setStatus("error");
      }
    }
  };
  useEffect(() => {
    if (requestedItemId && targets.some((candidate) => candidate.itemId === requestedItemId)) {
      ++loadGeneration.current;
      invalidatePreview();
      setItemId(requestedItemId);
      setReason("");
      setConfirmed(false);
    }
  }, [requestedItemId]);
  useEffect(() => { void reload(); }, [itemId]);
  const current = detail?.revisions.find((revision) =>
    revision.lifecycle === "current" || revision.lifecycle === "disabled",
  );
  const inspect = async () => {
    if (!detail || detail.item.id !== itemId || !current || busy) return;
    setBusy(true);
    invalidatePreview();
    const generation = previewGeneration.current;
    setMessage("");
    try {
      const q = query();
      q.set("expectedVersion", String(detail.item.version));
      q.set("label", current.label);
      q.set("enabled", String(target.enabled));
      q.set("effectiveFrom", cutover);
      const response = await fetch(BASE + "/preview?" + q);
      if (!response.ok) {
        if (generation === previewGeneration.current) {
          setPreviewReadiness(classifyMasterPreviewReadiness(response.status));
        }
        return;
      }
      const result = await response.json() as MasterPreview;
      if (generation === previewGeneration.current) {
        setPreview(result);
        setPreviewReadiness(classifyMasterPreviewReadiness(response.status, result));
      }
    } catch {
      if (generation === previewGeneration.current) {
        setPreviewReadiness(classifyMasterPreviewReadiness(null));
      }
    } finally {
      setBusy(false);
    }
  };
  const execute = async () => {
    if (!detail || detail.item.id !== itemId || !current || previewReadiness !== "reviewable"
      || !preview?.available || !preview.priorRevisionId
      || preview.enabled !== target.enabled || !confirmed || !reason.trim() || busy) return;
    setBusy(true);
    setMessage("");
    const generation = previewGeneration.current;
    try {
      const csrfResponse = await fetch("/api/auth/csrf");
      if (!csrfResponse.ok) throw new Error("csrf_failed");
      const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
      if (generation !== previewGeneration.current) {
        setMessage("下見後に入力が変更されました。新しい下見を取得してください");
        return;
      }
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
      const receipt = response.ok
        ? await response.json().catch(() => null) as MasterOperationReceipt | null
        : null;
      const outcome = classifyMasterOperationOutcome(response.status, receipt);
      setMessage(outcome === "verified"
        ? "状態変更を予約し、履歴と永続監査を検証しました"
        : masterOperationRecoveryMessage(outcome) + "（HTTP " + response.status + "）");
      if (outcome === "verified") setReason("");
      setConfirmed(false);
      await reload();
    } catch {
      setConfirmed(false);
      setMessage(masterOperationRecoveryMessage("unknown"));
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
          ++loadGeneration.current;
          invalidatePreview(); setItemId(event.target.value); setReason("");
        }}>
          {targets.map((option) => <option key={option.itemId} value={option.itemId}>{option.label}</option>)}
        </select>
      </label>
      {status === "loading" && <p role="status">デモの状態を取得しています…</p>}
      {status === "error" && <p role="alert">マスタを取得できませんでした</p>}
      {status === "ready" && detail?.item.id === itemId && <div>
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
          placeholder={CUTOFF} onChange={(value) => { setCutover(value); invalidatePreview(); }} />
        <button type="button" onClick={() => { void inspect(); }} disabled={busy || !current}>状態変更を下見</button>
        {previewReadiness && <p role="status" data-testid="master-availability-readiness">
          {masterPreviewReadinessMessage(previewReadiness)}
        </p>}
        {preview && <div className="admin-retry-panel">
          <p data-testid="master-availability-preview">
            {String(preview.currentEnabled)} → {String(preview.enabled)} ／
            Risk: {preview.preview.risk} ／ Policy: {preview.preview.policyDecision}
          </p>
          {previewReadiness === "reviewable" && preview.available && preview.preview.policyDecision === "REQUIRE_REASON"
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
