import { useEffect, useRef, useState } from "react";
import { classifyMasterOperationOutcome, masterOperationRecoveryMessage, type MasterOperationReceipt } from "./master-operation-outcome";
import { MasterFutureDateField, MasterOperationConfirmationFields } from "./MasterOperationFormFields";
import { WORKHUB_SCHEDULE_DEMO_ITEM_ID, WORKHUB_ORDER_DEMO_ITEM_ID } from "../workhub/travel-request";

const path = "/api/admin/master-operations/schedule";
interface Item {
  readonly code: string;
  readonly version: number;
  readonly retiredAt: string | null;
}
interface Revision {
  readonly revision: number;
  readonly label: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly lifecycle: string;
  readonly displayOrder: number;
}
interface Detail {
  readonly item: Item;
  readonly revisions: readonly Revision[];
}
interface SchedulePreview {
  readonly item: Item;
  readonly priorRevisionId: string | null;
  readonly currentLabel: string | null;
  readonly currentDisplayOrder: number | null;
  readonly displayOrder: number | null;
  readonly available: boolean;
  readonly reasonCode: string | null;
  readonly policyVersion: string;
  readonly preview: { readonly risk: string; readonly policyDecision: string };
}
type Status = "idle" | "loading" | "ready" | "error";

export default function MasterScheduleDemo({ variant = "revision" }: { readonly variant?: "revision" | "order" }) {
  const orderVariant = variant === "order";
  const demoItemId = orderVariant ? WORKHUB_ORDER_DEMO_ITEM_ID : WORKHUB_SCHEDULE_DEMO_ITEM_ID;
  const itemQuery = new URLSearchParams({
    scopeId: "workhub-company", masterKey: "workhub.office", itemId: demoItemId,
  });
  const operationQuery = new URLSearchParams({ scopeId: "workhub-company", itemId: demoItemId });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(orderVariant ? "2027-10-01T00:00:00.000Z" : "2027-04-01T00:00:00.000Z");
  const [label, setLabel] = useState(orderVariant ? "Order demo unchanged" : "Scheduled Office Next");
  const [displayOrder, setDisplayOrder] = useState<number | undefined>(orderVariant ? 73 : undefined);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const previewGeneration = useRef(0);
  const invalidatePreview = () => {
    ++previewGeneration.current;
    setPreview(null);
    setConfirmed(false);
  };

  const load = async () => {
    invalidatePreview();
    setStatus("loading");
    try {
      const response = await fetch("/api/admin/master-data?" + itemQuery);
      if (!response.ok) throw new Error("master_detail_unavailable");
      setDetail(await response.json() as Detail);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };
  useEffect(() => { void load(); }, [variant]);

  const inspect = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setMessage("");
    invalidatePreview();
    const generation = previewGeneration.current;
    try {
      const query = new URLSearchParams(operationQuery);
      query.set("expectedVersion", String(detail.item.version));
      query.set("effectiveFrom", effectiveFrom);
      query.set("label", label);
      if (displayOrder !== undefined) query.set("displayOrder", String(displayOrder));
      const response = await fetch(path + "/preview?" + query);
      if (!response.ok) {
        setMessage("下見を取得できませんでした。日時とラベルを確認してください（HTTP " + response.status + "）");
        return;
      }
      const result = await response.json() as SchedulePreview;
      if (generation === previewGeneration.current) setPreview(result);
    } catch {
      if (generation === previewGeneration.current) setMessage("下見を取得できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    if (!detail || !preview || !preview.available || !preview.priorRevisionId
      || !confirmed || !reason.trim() || busy) return;
    setBusy(true);
    setMessage("");
    const generation = previewGeneration.current;
    try {
      const csrf = await fetch("/api/auth/csrf");
      if (!csrf.ok) throw new Error("csrf_unavailable");
      const { csrfToken } = await csrf.json() as { readonly csrfToken: string };
      if (generation !== previewGeneration.current) {
        setMessage("下見後に入力が変更されました。新しい下見を取得してください");
        return;
      }
      const response = await fetch(path + "/execute?" + operationQuery, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          priorRevisionId: preview.priorRevisionId,
          expectedVersion: preview.item.version,
          effectiveFrom,
          label,
          ...(displayOrder === undefined ? {} : { displayOrder }),
          reason: reason.trim(),
          confirmed,
          previewPolicyVersion: preview.policyVersion,
        }),
      });
      const receipt = response.ok
        ? await response.json().catch(() => null) as MasterOperationReceipt | null
        : null;
      const outcome = classifyMasterOperationOutcome(response.status, receipt);
      setMessage(outcome === "verified"
        ? "将来Revisionの予約と切替前後の検証が完了しました"
        : masterOperationRecoveryMessage(outcome) + "（HTTP " + response.status + "）");
      if (outcome === "verified") setReason("");
      setConfirmed(false);
      await load();
    } catch {
      setConfirmed(false);
      setMessage(masterOperationRecoveryMessage("unknown"));
      await load();
    } finally {
      setBusy(false);
    }
  };

  return <section className="admin-audit-panel" id={orderVariant ? "admin-master-order-demo" : "admin-master-schedule-demo"} aria-labelledby={orderVariant ? "admin-master-order-title" : "admin-master-schedule-title"}>
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">FUTURE CUTOVER / PREVIEW DEMO</p>
        <h2 id={orderVariant ? "admin-master-order-title" : "admin-master-schedule-title"}>{orderVariant ? "マスタ表示順の将来改訂（専用デモ）" : "マスタの将来改訂（専用デモ）"}</h2>
        <p>{orderVariant ? "出張申請で使わないORDER_DEMO拠点のみ。名称・有効状態は変更せず、表示順だけを将来のRevisionに予約します。" : "出張申請で使わないSCHEDULE_DEMO拠点のみ。現行Revisionの終了と将来Revisionの追加を一体で行い、過去の履歴は残します。"}</p>
      </div>
    </div>
    {status === "loading" && <div role="status" className="admin-audit-state">マスタを取得しています…</div>}
    {status === "error" && <div role="alert" className="admin-audit-state is-error">マスタを確認できませんでした。Previewデモ専用の操作です。</div>}
    {status === "ready" && detail && <div className="admin-retry-panel">
      <p>Command: <strong>SCHEDULE_MASTER_REVISION</strong> / 対象: <strong>{detail.item.code}</strong> / Version: {detail.item.version}</p>
      <p>履歴: <strong data-testid="master-schedule-history">{detail.revisions.length} Revision</strong></p>
      <div className="admin-audit-table-wrap">
        <table className="admin-audit-table">
          <thead><tr><th>Revision</th><th>表示名</th><th>開始 UTC</th><th>終了 UTC</th><th>表示順</th><th>状態</th></tr></thead>
          <tbody>{detail.revisions.map((rev) => <tr key={rev.revision}>
            <td>{rev.revision}</td><td>{rev.label}</td>
            <td>{rev.effectiveFrom}</td><td>{rev.effectiveTo ?? "open-ended"}</td><td>{rev.displayOrder}</td>
            <td>{rev.lifecycle}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void inspect(); }}>
        <MasterFutureDateField label="改訂開始日時（ISO 8601 / UTC）"
          value={effectiveFrom} placeholder="2027-04-01T00:00:00.000Z"
          onChange={(value) => { setEffectiveFrom(value); invalidatePreview(); }} />
        <label>新しい拠点表示名
          <input value={label} readOnly={orderVariant} onChange={(event) => { setLabel(event.target.value); invalidatePreview(); }}
            maxLength={256} required />
        </label>
        {orderVariant && <label>改訂後の表示順
          <input type="number" min={-1000000} max={1000000} step={1}
            value={displayOrder ?? ""} onChange={(event) => {
              setDisplayOrder(event.target.value === "" ? undefined : Number(event.target.value));
              invalidatePreview();
            }} required />
        </label>}
        <div className="admin-retry-actions">
          <button type="submit" disabled={busy}>切替内容を下見</button>
        </div>
      </form>
      {preview && <div className="admin-retry-panel">
        <p>現在の名称：{preview.currentLabel ?? "なし"} → 予約後：{label}</p>
        {orderVariant && <p data-testid="master-order-preview">表示順：{preview.currentDisplayOrder ?? "-"} → {preview.displayOrder ?? "-"}</p>}
        <p>Risk: {preview.preview.risk} / Policy: {preview.preview.policyDecision}</p>
        {preview.available && preview.preview.policyDecision === "REQUIRE_REASON"
          ? <form onSubmit={(event) => { event.preventDefault(); void schedule(); }}>
              <MasterOperationConfirmationFields
                reason={reason} onReasonChange={setReason} reasonLabel="変更理由"
                confirmed={confirmed} onConfirmChange={setConfirmed}
                confirmationLabel="現行期間の終了・将来改訂の開始日時・過去履歴の保持を確認しました"
                busy={busy} submitLabel="将来改訂を予約" />
            </form>
          : <p>予約できません：{preview.reasonCode ?? "有効期間がすでに変更されています"}</p>}
      </div>}
    </div>}
    {message && <div role="status" className="admin-audit-state">{message}</div>}
  </section>;
}
