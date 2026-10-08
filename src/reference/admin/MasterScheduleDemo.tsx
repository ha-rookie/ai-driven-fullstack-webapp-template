import { useEffect, useState } from "react";
import { WORKHUB_SCHEDULE_DEMO_ITEM_ID, WORKHUB_STATE_DEMO_ITEM_ID } from "../workhub/travel-request";

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
  readonly enabled: boolean;
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
  readonly currentEnabled: boolean | null;
  readonly currentDisplayOrder: number | null;
  readonly enabled: boolean;
  readonly displayOrder: number | null;
  readonly available: boolean;
  readonly reasonCode: string | null;
  readonly policyVersion: string;
  readonly preview: { readonly risk: string; readonly policyDecision: string };
}
type Status = "loading" | "ready" | "error";

export default function MasterScheduleDemo({ variant = "revision" }: { readonly variant?: "revision" | "state" }) {
  const stateVariant = variant === "state";
  const demoItemId = stateVariant ? WORKHUB_STATE_DEMO_ITEM_ID : WORKHUB_SCHEDULE_DEMO_ITEM_ID;
  const itemQuery = new URLSearchParams({
    scopeId: "workhub-company", masterKey: "workhub.office", itemId: demoItemId,
  });
  const operationQuery = new URLSearchParams({ scopeId: "workhub-company", itemId: demoItemId });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    stateVariant ? "2027-07-01T00:00:00.000Z" : "2027-04-01T00:00:00.000Z",
  );
  const [label, setLabel] = useState(stateVariant ? "State demo unchanged" : "Scheduled Office Next");
  const [enabled, setEnabled] = useState(!stateVariant);
  const [displayOrder, setDisplayOrder] = useState<number | undefined>(
    stateVariant ? 70 : undefined,
  );
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/admin/master-data?" + itemQuery);
      if (!response.ok) throw new Error("master_detail_unavailable");
      setDetail(await response.json() as Detail);
      setPreview(null);
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
    setPreview(null);
    setConfirmed(false);
    try {
      const query = new URLSearchParams(operationQuery);
      query.set("expectedVersion", String(detail.item.version));
      query.set("effectiveFrom", effectiveFrom);
      query.set("label", label);
      query.set("enabled", String(enabled));
      if (displayOrder !== undefined) query.set("displayOrder", String(displayOrder));
      const response = await fetch(path + "/preview?" + query);
      if (!response.ok) {
        setMessage("下見を取得できませんでした。日時とラベルを確認してください（HTTP " + response.status + "）");
        return;
      }
      setPreview(await response.json() as SchedulePreview);
    } catch {
      setMessage("下見を取得できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    if (!detail || !preview || !preview.available || !preview.priorRevisionId
      || !confirmed || !reason.trim() || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const csrf = await fetch("/api/auth/csrf");
      if (!csrf.ok) throw new Error("csrf_unavailable");
      const { csrfToken } = await csrf.json() as { readonly csrfToken: string };
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
          enabled,
          ...(displayOrder === undefined ? {} : { displayOrder }),
          reason: reason.trim(),
          confirmed,
          previewPolicyVersion: preview.policyVersion,
        }),
      });
      const result = await response.json() as {
        readonly execution?: { readonly result: string };
        readonly verification?: { readonly status: string };
      };
      if (response.ok && result.execution?.result === "SUCCESS"
        && result.verification?.status === "PASSED") {
        setMessage("将来Revisionの予約と切替前後の検証が完了しました");
        setReason("");
        setConfirmed(false);
      } else {
        setMessage("予約は完了していません。最新の状態を再確認してください（HTTP " + response.status + "）");
      }
      await load();
    } catch {
      setMessage("予約結果を確認できません。最新の履歴を確認してください");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return <section className="admin-audit-panel" id={stateVariant ? "admin-master-state-demo" : "admin-master-schedule-demo"} aria-labelledby={stateVariant ? "admin-master-state-title" : "admin-master-schedule-title"}>
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">FUTURE CUTOVER / PREVIEW DEMO</p>
        <h2 id={stateVariant ? "admin-master-state-title" : "admin-master-schedule-title"}>{stateVariant ? "マスタ有効・無効／表示順（専用デモ）" : "マスタの将来改訂（専用デモ）"}</h2>
        <p>{stateVariant ? "出張申請で使わないSTATE_DEMO拠点のみ。将来の有効/無効と表示順をRevisionとして予約し、履歴を保存します。" : "出張申請で使わないSCHEDULE_DEMO拠点のみ。現行Revisionの終了と将来Revisionの追加を一体で行い、過去の履歴は残します。"}</p>
      </div>
    </div>
    {status === "loading" && <div role="status" className="admin-audit-state">マスタを取得しています…</div>}
    {status === "error" && <div role="alert" className="admin-audit-state is-error">マスタを確認できませんでした。Previewデモ専用の操作です。</div>}
    {status === "ready" && detail && <div className="admin-retry-panel">
      <p>Command: <strong>SCHEDULE_MASTER_REVISION</strong> / 対象: <strong>{detail.item.code}</strong> / Version: {detail.item.version}</p>
      <p>履歴: <strong data-testid="master-schedule-history">{detail.revisions.length} Revision</strong></p>
      <div className="admin-audit-table-wrap">
        <table className="admin-audit-table">
          <thead><tr><th>Revision</th><th>表示名</th><th>開始 UTC</th><th>終了 UTC</th><th>有効</th><th>表示順</th><th>状態</th></tr></thead>
          <tbody>{detail.revisions.map((rev) => <tr key={rev.revision}>
            <td>{rev.revision}</td><td>{rev.label}</td>
            <td>{rev.effectiveFrom}</td><td>{rev.effectiveTo ?? "open-ended"}</td>
            <td>{rev.enabled ? "有効" : "無効"}</td><td>{rev.displayOrder}</td>
            <td>{rev.lifecycle}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void inspect(); }}>
        <label>改訂開始日時（ISO 8601 / UTC）
          <input value={effectiveFrom} onChange={(event) => { setEffectiveFrom(event.target.value); setPreview(null); }}
            placeholder="2027-04-01T00:00:00.000Z" required />
        </label>
        <label>新しい拠点表示名
          <input value={label} onChange={(event) => { setLabel(event.target.value); setPreview(null); }}
            maxLength={256} required />
        </label>
        {stateVariant && <>
          <label>改訂後の有効状態
            <select value={enabled ? "enabled" : "disabled"} onChange={(event) => {
              setEnabled(event.target.value === "enabled"); setPreview(null);
            }}>
              <option value="enabled">有効</option>
              <option value="disabled">無効（選択不可）</option>
            </select>
          </label>
          <label>改訂後の表示順
            <input type="number" min={-1000000} max={1000000} step={1}
              value={displayOrder ?? ""} onChange={(event) => {
                const value = event.target.value;
                setDisplayOrder(value === "" ? undefined : Number(value)); setPreview(null);
              }} />
          </label>
        </>}
        <div className="admin-retry-actions">
          <button type="submit" disabled={busy}>切替内容を下見</button>
        </div>
      </form>
      {preview && <div className="admin-retry-panel">
        <p>現在の名称：{preview.currentLabel ?? "なし"} → 予約後：{label}</p>
        {stateVariant && <p data-testid="master-state-preview">
          状態：{preview.currentEnabled ? "有効" : "無効"} → {preview.enabled ? "有効" : "無効"}、
          表示順：{preview.currentDisplayOrder ?? "-"} → {preview.displayOrder ?? "-"}
        </p>}
        <p>Risk: {preview.preview.risk} / Policy: {preview.preview.policyDecision}</p>
        {preview.available && preview.preview.policyDecision === "REQUIRE_REASON"
          ? <form onSubmit={(event) => { event.preventDefault(); void schedule(); }}>
              <label>変更理由
                <textarea value={reason} onChange={(event) => setReason(event.target.value)}
                  maxLength={200} required />
              </label>
              <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                現行期間の終了・将来改訂の開始日時・過去履歴の保持を確認しました
              </label>
              <div className="admin-retry-actions">
                <button type="submit" disabled={busy || !confirmed || !reason.trim()}>将来改訂を予約</button>
              </div>
            </form>
          : <p>予約できません：{preview.reasonCode ?? "有効期間がすでに変更されています"}</p>}
      </div>}
    </div>}
    {message && <div role="status" className="admin-audit-state">{message}</div>}
  </section>;
}
