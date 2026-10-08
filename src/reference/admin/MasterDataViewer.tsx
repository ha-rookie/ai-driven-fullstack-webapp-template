import { useEffect, useState } from "react";

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

export default function MasterDataViewer() {
  const [list, setList] = useState<LoadState<MasterListResponse>>({ kind: "loading" });
  const [detail, setDetail] = useState<LoadState<MasterDetailResponse>>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState("");

  const loadDetail = async (itemId: string) => {
    setSelectedId(itemId);
    setDetail({ kind: "loading" });
    try {
      const response = await fetch(listUrl + "&itemId=" + encodeURIComponent(itemId), {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        setDetail({ kind: "error", requestId: response.headers.get("x-request-id") });
        return;
      }
      setDetail({ kind: "ready", data: await response.json() as MasterDetailResponse });
    } catch {
      setDetail({ kind: "error", requestId: null });
    }
  };

  const loadList = async () => {
    setList({ kind: "loading" });
    try {
      const response = await fetch(listUrl, { headers: { accept: "application/json" } });
      if (!response.ok) {
        setList({ kind: "error", requestId: response.headers.get("x-request-id") });
        return;
      }
      const data = await response.json() as MasterListResponse;
      setList({ kind: "ready", data });
      if (data.items.length > 0) {
        await loadDetail(data.items[0].id);
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
