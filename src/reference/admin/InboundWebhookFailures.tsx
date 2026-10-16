import { useEffect, useState } from "react";

/**
 * #419: bounded local inbound webhook failure evidence only.
 * A stored receipt is not a provider availability probe or a replay payload.
 */
const SCOPE_ID = "workhub-company";
const BASE = "/api/admin/integrations/inbound";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const providerPattern = /^[a-z][a-z0-9._-]{0,63}$/u;
const cursorPattern = /^[A-Za-z0-9_-]{1,512}$/u;
const codes = new Set(["business_processing_failed", "other"]);

interface FailureReceipt {
  readonly receiptId: string;
  readonly providerKey: string;
  readonly status: "failed" | "dead_letter";
  readonly attemptCount: number;
  readonly receivedAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly failureCode: string;
}
interface FailurePage {
  readonly coverage: "environment";
  readonly source: "local_inbound_receipt";
  readonly environment: string;
  readonly pageLimit: 20;
  readonly items: readonly FailureReceipt[];
  readonly nextCursor: string | null;
  readonly replayAvailable: false;
}
interface FailureDetail {
  readonly coverage: "environment";
  readonly source: "local_inbound_receipt";
  readonly environment: string;
  readonly receipt: FailureReceipt;
  readonly decision: {
    readonly nextAction: "inspect_processing_failure";
    readonly manualRetryAllowed: false;
    readonly replayAvailable: false;
  };
}
type Result<T> =
  | { readonly kind: "ready"; readonly data: T }
  | { readonly kind: "denied" | "unknown" };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): boolean =>
  typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
const receipt = (value: unknown): value is FailureReceipt =>
  record(value)
  && typeof value.receiptId === "string" && idPattern.test(value.receiptId)
  && typeof value.providerKey === "string" && providerPattern.test(value.providerKey)
  && (value.status === "failed" || value.status === "dead_letter")
  && Number.isSafeInteger(value.attemptCount) && Number(value.attemptCount) >= 0
  && Number.isSafeInteger(value.version) && Number(value.version) > 0
  && timestamp(value.receivedAt) && timestamp(value.updatedAt)
  && typeof value.failureCode === "string" && codes.has(value.failureCode);
const isPage = (value: unknown): value is FailurePage =>
  record(value) && value.coverage === "environment" && value.source === "local_inbound_receipt"
  && typeof value.environment === "string" && value.environment.length > 0
  && value.pageLimit === 20 && value.replayAvailable === false
  && (value.nextCursor === null || (typeof value.nextCursor === "string"
    && cursorPattern.test(value.nextCursor)))
  && Array.isArray(value.items) && value.items.length <= 20
  && value.items.every(receipt);
const isDetail = (value: unknown): value is FailureDetail =>
  record(value) && value.coverage === "environment" && value.source === "local_inbound_receipt"
  && typeof value.environment === "string" && receipt(value.receipt)
  && record(value.decision) && value.decision.nextAction === "inspect_processing_failure"
  && value.decision.manualRetryAllowed === false && value.decision.replayAvailable === false;
const request = async <T,>(path: string, valid: (value: unknown) => value is T): Promise<Result<T>> => {
  try {
    const result = await fetch(path, { cache: "no-store", headers: { accept: "application/json" } });
    if (result.status === 401 || result.status === 403) return { kind: "denied" };
    if (!result.ok) return { kind: "unknown" };
    const value: unknown = await result.json();
    return valid(value) ? { kind: "ready", data: value } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
};
const unavailable = (result: Result<unknown>): string =>
  result.kind === "denied" ? "閲覧権限がありません" : "取得できません（正常・0件とは判定しません）";

export function ReceiptDetail({ receiptId, environment }: {
  readonly receiptId: string; readonly environment: string;
}) {
  const [state, setState] = useState<Result<FailureDetail> | null>(null);
  useEffect(() => {
    let active = true;
    setState(null);
    void request(BASE + "/" + encodeURIComponent(receiptId)
      + "?scopeId=" + SCOPE_ID, isDetail).then(result => {
      if (active) setState(result.kind === "ready"
        && (result.data.environment !== environment || result.data.receipt.receiptId !== receiptId)
        ? { kind: "unknown" } : result);
    });
    return () => { active = false; };
  }, [receiptId, environment]);
  return <div role="status" data-testid="inbound-webhook-detail">
    <h5>受信Webhookの個別確認：<code>{receiptId}</code></h5>
    {state === null ? <p>確認中…</p>
      : state.kind !== "ready" ? <p>{unavailable(state)}</p>
        : <>
          <p>Provider識別子：{state.data.receipt.providerKey}
            {" / 状態：" + state.data.receipt.status}
            {" / Version: " + state.data.receipt.version}</p>
          <p>受信日時：{state.data.receipt.receivedAt}
            {" / 最終更新：" + state.data.receipt.updatedAt}</p>
          <p>試行回数：{state.data.receipt.attemptCount}
            {" / 安全な失敗コード：" + state.data.receipt.failureCode}</p>
          <p><strong>再実行不可：</strong>受信後の業務処理を調査してください。
            この記録は検証済み受信のメタデータのみで、原文やProvider側の再配送結果は含みません。
            原文・冪等性・承認と監査を確認せずに再処理はできません。</p>
        </>}
  </div>;
}

export default function InboundWebhookFailures({ environment }: { readonly environment: string }) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [state, setState] = useState<Result<FailurePage> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let active = true;
    setState(null);
    setSelected(null);
    const query = new URLSearchParams({
      scopeId: SCOPE_ID, ...(cursor ? { cursor } : {}),
    });
    void request(BASE + "/_failures?" + query.toString(), isPage).then(result => {
      if (active) setState(result.kind === "ready" && result.data.environment !== environment
        ? { kind: "unknown" } : result);
    });
    return () => { active = false; };
  }, [environment, cursor]);

  return <div className="admin-audit-state" data-testid="inbound-webhook-failures">
    <h4>受信Webhookの失敗記録（20件ずつ）</h4>
    <p>既存D1の受信記録からfailed・dead_letterを確認します。
      認証済みの受信処理に限り、署名検証前の拒否・外部Providerの稼働状況・外部Storageは含みません。
      記録が0件でもProviderが正常とは限りません。表示は参照専用で、再処理はできません。</p>
    {state === null ? <p role="status">受信失敗記録を取得中…</p>
      : state.kind !== "ready" ? <p role="status">{unavailable(state)}</p>
        : <>
          {state.data.items.length === 0
            ? <p>現在の受信失敗記録は該当なし（外部Providerの正常性は未確認）</p>
            : <ul>{state.data.items.map(item => <li key={item.receiptId}>
              <code>{item.receiptId}</code> / {item.providerKey} — {item.status}
              {" / 試行 " + item.attemptCount + " 回 / " + item.failureCode + " / " + item.updatedAt}{" "}
              <button type="button" onClick={() => setSelected(item.receiptId)}>受信処理の詳細を確認</button>
            </li>)}</ul>}
          <div className="admin-retry-actions">
            <button type="button" disabled={cursors.length === 1}
              onClick={() => setCursors(history => history.slice(0, -1))}>前の20件</button>
            <button type="button" disabled={!state.data.nextCursor}
              onClick={() => {
                if (state.data.nextCursor) setCursors(history => [...history, state.data.nextCursor]);
              }}>次の20件</button>
          </div>
          {selected && state.data.items.some(item => item.receiptId === selected)
            ? <ReceiptDetail key={selected} receiptId={selected} environment={environment} /> : null}
        </>}
  </div>;
}
