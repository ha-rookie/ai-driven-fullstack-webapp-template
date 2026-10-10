import { useEffect, useRef, useState } from "react";
import type { MasterViewDefinition } from "./master-admin-operation-config";
interface MasterDataViewerProps {
  readonly scopeId: string;
  readonly definitions: readonly [MasterViewDefinition, ...MasterViewDefinition[]];
  readonly onSelectionChange?: (itemId: string | null) => void;
}

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
  readonly allowedOperations?: readonly ("schedule" | "retire")[];
  readonly revisions: readonly MasterRevision[];
  readonly hasMore: boolean;
  readonly asOf: string;
}
type LoadState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: T }
  | { readonly kind: "error"; readonly requestId: string | null };

const dateTime = (value: string): string => new Date(value).toLocaleString("ja-JP");

export default function MasterDataViewer({
  scopeId, definitions, onSelectionChange,
}: MasterDataViewerProps) {
  const [requestedMasterKey, setRequestedMasterKey] = useState(definitions[0].masterKey);
  const definition = definitions.find((entry) => entry.masterKey === requestedMasterKey) ?? definitions[0];
  const masterKey = definition.masterKey;
  const listUrl = "/api/admin/master-data?" + new URLSearchParams({
    scopeId, masterKey,
  }).toString();
  const [list, setList] = useState<LoadState<MasterListResponse>>({ kind: "loading" });
  const [detail, setDetail] = useState<LoadState<MasterDetailResponse>>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState("");
  const currentItemId = useRef("");
  const detailRequest = useRef(0);
  const listRequest = useRef(0);

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
    const request = ++listRequest.current;
    ++detailRequest.current; // invalidate an older detail response before refreshing
    setList({ kind: "loading" });
    setDetail({ kind: "loading" });
    try {
      const response = await fetch(listUrl, { headers: { accept: "application/json" } });
      if (request !== listRequest.current) return;
      if (!response.ok) {
        setList({ kind: "error", requestId: response.headers.get("x-request-id") });
        return;
      }
      const data = await response.json() as MasterListResponse;
      if (request !== listRequest.current) return;
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
      if (request === listRequest.current) setList({ kind: "error", requestId: null });
    }
  };

  useEffect(() => {
    currentItemId.current = "";
    onSelectionChange?.(null);
    void loadList();
    return () => {
      ++listRequest.current;
      ++detailRequest.current;
    };
  }, [listUrl]);

  // A rendered item is linked only when this Definition explicitly declares it.
  const selectedOperation = detail.kind === "ready"
    && Object.prototype.hasOwnProperty.call(definition.operations, detail.data.item.id)
    ? definition.operations[detail.data.item.id]
    : undefined;
  // Missing/invalid server capabilities are NOT grants. A configured UI link
  // never overrides Worker scope, role, target allowlist or Production gating.
  const canShowOperation = selectedOperation !== undefined && detail.kind === "ready"
    && detail.data.allowedOperations?.includes(selectedOperation.requiredCapability) === true;

  return <section className="admin-audit-panel" id="admin-master-data" aria-labelledby="admin-master-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">MASTER DATA / READ ONLY</p>
        <h2 id="admin-master-title">マスタ管理（参照）</h2>
        <p>有効期間・廃止・Revision履歴を確認します。登録・変更・削除はこの画面では行いません。過去の値を最新の表示名で上書きしないための確認入口です。</p>
      </div>
      <div className="admin-audit-scope">
        <span>Scope / Master</span>
        <strong>{scopeId}</strong>
        <strong>{masterKey}</strong>
      </div>
    </div>
    <div className="admin-audit-filters">
      <label htmlFor="admin-master-definition-select">マスタ定義
        <select id="admin-master-definition-select" value={masterKey}
          disabled={definitions.length === 1}
          onChange={(event) => setRequestedMasterKey(event.target.value)}>
          {definitions.map((entry) => <option key={entry.masterKey} value={entry.masterKey}>
            {entry.label}
          </option>)}
        </select>
      </label>
      <p className="admin-audit-note">Projectに設定された参照定義のみ表示します。参照可否・変更権限はAPI側で判定されます。</p>
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
            : canShowOperation && selectedOperation
              ? <a className="admin-section-link" href={selectedOperation.href}>
                  {selectedOperation.label} →
                </a>
              : selectedOperation
                ? <p>この項目の操作はサーバー側で利用可能と確認できません。参照のみ可能です。</p>
                : <p>この項目に設定された変更操作はありません。参照のみ可能です。</p>}
          <small>Project側の操作設定と、サーバーが返した対象・権限情報の両方が一致した場合のみ操作導線を表示します。下見・実行時も再認可され、Productionへの変更は許可されません。</small>
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
