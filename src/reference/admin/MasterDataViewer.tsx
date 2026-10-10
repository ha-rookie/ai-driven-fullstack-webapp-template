import { useEffect, useRef, useState } from "react";
import {
  WORKHUB_RETIRE_DEMO_ITEM_ID, WORKHUB_SCHEDULE_DEMO_ITEM_ID,
  WORKHUB_ORDER_DEMO_ITEM_ID, WORKHUB_AVAILABILITY_DISABLE_ITEM_ID,
  WORKHUB_AVAILABILITY_ENABLE_ITEM_ID,
} from "../workhub/travel-request";

const WORKHUB_SCOPE_ID = "workhub-company";
const WORKHUB_MASTER_KEY = "workhub.office";

interface MasterItem {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly retiredAt: string | null;
}
interface MasterRevision {
  readonly id: string;
  readonly revision: number;
  readonly label: string;
  readonly enabled: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly displayOrder: number;
  readonly parentItemId: string | null;
  readonly lifecycle: "current" | "future" | "expired" | "disabled" | "retired";
}
interface MasterListResponse {
  readonly items: readonly MasterItem[];
  readonly hasMore: boolean;
  readonly environment: string;
  readonly asOf: string;
}
interface MasterDetailResponse {
  readonly item: MasterItem;
  readonly revisions: readonly MasterRevision[];
  readonly hasMore: boolean;
  readonly asOf: string;
}
type LoadState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: T }
  | { readonly kind: "error"; readonly requestId: string | null };

const listUrl = "/api/admin/master-data?" + new URLSearchParams({
  scopeId: WORKHUB_SCOPE_ID,
  masterKey: WORKHUB_MASTER_KEY,
}).toString();

const dateTime = (value: string): string => new Date(value).toLocaleString("ja-JP");

/** Reference-only action destinations; actual authorization and allowlists belong to the API. */
const DEMO_MASTER_ACTIONS: Readonly<Record<string, { readonly href: string; readonly label: string }>> = {
  [WORKHUB_RETIRE_DEMO_ITEM_ID]: { href: "#admin-master-retire-demo", label: "廃止操作の下見へ" },
  [WORKHUB_SCHEDULE_DEMO_ITEM_ID]: { href: "#admin-master-schedule-demo", label: "将来Revision予約の下見へ" },
  [WORKHUB_ORDER_DEMO_ITEM_ID]: { href: "#admin-master-order-demo", label: "将来表示順変更の下見へ" },
  [WORKHUB_AVAILABILITY_DISABLE_ITEM_ID]: { href: "#admin-master-availability", label: "有効・無効切替の下見へ" },
  [WORKHUB_AVAILABILITY_ENABLE_ITEM_ID]: { href: "#admin-master-availability", label: "有効・無効切替の下見へ" },
};


export default function MasterDataViewer({ onSelectionChange }: {
  readonly onSelectionChange?: (itemId: string | null) => void;
}) {
  const [list, setList] = useState<LoadState<MasterListResponse>>({ kind: "loading" });
  const [detail, setDetail] = useState<LoadState<MasterDetailResponse>>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState("");
  const currentItemId = useRef("");
  const detailRequest = useRef(0);

  const loadDetail = async (itemId: string) => {
    const request = ++detailRequest.current;
    currentItemId.current = itemId;
    onSelectionChange?.(itemId);
    setSelectedId(itemId);
    setDetail({ kind: "loading" });
    try {
      const response = await fetch(listUrl + "&itemId=" + encodeURIComponent(itemId), {
        headers: { accept: "application/json" },
      });
      if (request !== detailRequest.current) return;
      if (!response.ok) {
        setDetail({ kind: "error", requestId: response.headers.get("x-request-id") });
        return;
      }
      const data = await response.json() as MasterDetailResponse;
      if (request === detailRequest.current) setDetail({ kind: "ready", data });
    } catch {
      if (request === detailRequest.current) setDetail({ kind: "error", requestId: null });
    }
  };

  const loadList = async () => {
    ++detailRequest.current; // invalidate an older detail response before refreshing
    setList({ kind: "loading" });
    setDetail({ kind: "loading" });
    try {
      const response = await fetch(listUrl, { headers: { accept: "application/json" } });
      if (!response.ok) {
        setList({ kind: "error", requestId: response.headers.get("x-request-id") });
        return;
      }
      const data = await response.json() as MasterListResponse;
      setList({ kind: "ready", data });
      if (data.items.length > 0) {
        const selected = data.items.find((item) => item.id === currentItemId.current);
        await loadDetail(selected?.id ?? data.items[0].id);
      } else {
        currentItemId.current = "";
        onSelectionChange?.(null);
        setSelectedId("");
      }
    } catch {
      setList({ kind: "error", requestId: null });
    }
  };

  useEffect(() => { void loadList(); }, []);

  return <section className="admin-audit-panel" id="admin-master-data" aria-labelledby="admin-master-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">MASTER DATA / READ ONLY</p>
        <h2 id="admin-master-title">マスタ管理（参照）</h2>
        <p>有効期間・廃止・Revision履歴を確認します。登録・変更・削除はこの画面では行いません。過去の値を最新の表示名で上書きしないための確認入口です。</p>
      </div>
      <div className="admin-audit-scope">
        <span>Scope / Master</span>
        <strong>{WORKHUB_SCOPE_ID}</strong>
        <strong>{WORKHUB_MASTER_KEY}</strong>
      </div>
    </div>
    <div className="admin-retry-actions">
      <button type="button" disabled={list.kind === "loading"} onClick={() => { void loadList(); }}>
        マスタ一覧・Revision履歴を再取得
      </button>
    </div>

    {list.kind === "loading" && <div className="admin-audit-state" role="status">マスタを取得しています…</div>}
    {list.kind === "error" && <div className="admin-audit-state is-error" role="alert">
      <strong>マスタを取得できませんでした</strong>
      <span>{list.requestId ? "Request ID: " + list.requestId : "再試行してください"}</span>
    </div>}
    {list.kind === "ready" && list.data.items.length === 0 && <div className="admin-audit-state">参照可能なマスタ項目はありません</div>}
    {list.kind === "ready" && list.data.items.length > 0 && <>
      <div className="admin-audit-filters">
        <label htmlFor="admin-master-item-select">マスタ項目
          <select id="admin-master-item-select" value={selectedId} onChange={(event) => { void loadDetail(event.target.value); }}>
            {list.data.items.map((item) => <option key={item.id} value={item.id}>{item.code} (v{item.version})</option>)}
          </select>
        </label>
        <p className="admin-audit-note">Environment: {list.data.environment} / {dateTime(list.data.asOf)} 時点</p>
      </div>
      {list.data.hasMore && <p className="admin-audit-note">一覧は先頭50件まで表示しています。全件取得は行いません。</p>}
      {detail.kind === "loading" && <div className="admin-audit-state" role="status">Revision履歴を取得しています…</div>}
      {detail.kind === "error" && <div className="admin-audit-state is-error" role="alert">
        <strong>Revision履歴を取得できませんでした</strong>
        <span>{detail.requestId ? "Request ID: " + detail.requestId : "再選択してください"}</span>
      </div>}
      {detail.kind === "ready" && <>
        <p className="admin-audit-note">Code: <strong>{detail.data.item.code}</strong> / Item version: {detail.data.item.version} / Retired: {detail.data.item.retiredAt ? dateTime(detail.data.item.retiredAt) : "NO"}</p>
        <nav className="admin-master-actions" aria-label="選択したマスタの操作導線">
          <strong>この項目の操作導線</strong>
          {detail.data.item.retiredAt !== null
            ? <p>廃止済みのため新たな操作は案内しません。履歴は参照できます。</p>
            : DEMO_MASTER_ACTIONS[detail.data.item.id]
              ? <a className="admin-section-link" href={DEMO_MASTER_ACTIONS[detail.data.item.id].href}>
                  {DEMO_MASTER_ACTIONS[detail.data.item.id].label} →
                </a>
              : <p>この項目に設定された変更操作はありません。参照のみ可能です。</p>}
          <small>WORKHUBの専用デモのみ。実行可否はサーバー側で再認可され、Productionへの変更は許可されません。</small>
        </nav>
        {detail.data.revisions.length === 0
          ? <div className="admin-audit-state">Revision履歴はありません</div>
          : <div className="admin-audit-table-wrap">
              <table className="admin-audit-table">
                <thead><tr><th>Revision</th><th>表示名</th><th>状態</th><th>有効開始</th><th>有効終了（含まない）</th><th>表示順</th></tr></thead>
                <tbody>{detail.data.revisions.map((revision) => <tr key={revision.id}>
                  <td>{revision.revision}</td>
                  <td><strong>{revision.label}</strong><small>{revision.id}</small></td>
                  <td><strong>{revision.lifecycle}</strong><small>{revision.enabled ? "enabled" : "disabled"}</small></td>
                  <td>{dateTime(revision.effectiveFrom)}</td>
                  <td>{revision.effectiveTo ? dateTime(revision.effectiveTo) : "open-ended"}</td>
                  <td>{revision.displayOrder}</td>
                </tr>)}</tbody>
              </table>
            </div>}
        {detail.data.hasMore && <p className="admin-audit-note">Revision履歴は最新50件のみ表示しています。</p>}
      </>}
    </>}
  </section>;
}
