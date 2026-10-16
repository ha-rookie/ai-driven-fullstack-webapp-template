import { useEffect, useState } from "react";

/**
 * #419: one operator queue over existing local Outbox and inbound receipts.
 * The server owns ordering, authorization and masking; no Provider probe/Retry.
 */
const ENDPOINT = "/api/admin/integrations/failures?scopeId=workhub-company";
type FailureSource = "outbound_delivery" | "inbound_webhook";
export interface FailureSelection { readonly source: FailureSource; readonly id: string }
interface FailureItem {
  readonly source: FailureSource;
  readonly id: string;
  readonly status: "retry_wait" | "dead_letter" | "failed";
  readonly attemptCount: number;
  readonly updatedAt: string;
  readonly version: number;
  readonly failureCode: string;
  readonly providerKey: string | null;
}
interface FailurePage {
  readonly coverage: "environment";
  readonly source: "local_failure_queue";
  readonly environment: string;
  readonly observedAt: string;
  readonly pageLimit: 20;
  readonly sources: readonly ["outbound_delivery", "inbound_webhook"];
  readonly items: readonly FailureItem[];
  readonly nextCursor: string | null;
  readonly providerReceipt: "unverified";
  readonly manualRetryAllowed: false;
}
type State =
  | { readonly kind: "loading" | "unknown" | "denied" }
  | { readonly kind: "ready"; readonly page: FailurePage };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const providerPattern = /^[a-z][a-z0-9._-]{0,63}$/u;
const allowedOutboxCodes = new Set([
  "event_missing", "delivery_exception", "retryable_failure",
  "permanent_failure", "provider_unavailable", "destination_disabled", "delivery_outcome_unknown", "other",
]);
const allowedInboundCodes = new Set(["business_processing_failed", "other"]);
const validItem = (value: unknown): value is FailureItem => {
  if (!record(value) || typeof value.id !== "string" || !idPattern.test(value.id)
    || !Number.isSafeInteger(value.attemptCount) || Number(value.attemptCount) < 0
    || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || typeof value.updatedAt !== "string" || value.updatedAt.length > 64
    || !Number.isFinite(Date.parse(value.updatedAt))) return false;
  if (value.source === "outbound_delivery") return (
    (value.status === "retry_wait" || value.status === "dead_letter")
    && value.providerKey === null && allowedOutboxCodes.has(String(value.failureCode)));
  if (value.source === "inbound_webhook") return (
    (value.status === "failed" || value.status === "dead_letter")
    && typeof value.providerKey === "string" && providerPattern.test(value.providerKey)
    && allowedInboundCodes.has(String(value.failureCode)));
  return false;
};
const validPage = (value: unknown): value is FailurePage =>
  record(value) && value.coverage === "environment"
  && value.source === "local_failure_queue"
  && typeof value.environment === "string" && value.environment.length > 0
  && typeof value.observedAt === "string" && value.observedAt.length <= 64
  && Number.isFinite(Date.parse(value.observedAt))
  && value.pageLimit === 20 && value.providerReceipt === "unverified"
  && value.manualRetryAllowed === false
  && Array.isArray(value.sources) && value.sources.length === 2
  && value.sources[0] === "outbound_delivery" && value.sources[1] === "inbound_webhook"
  && (value.nextCursor === null || (typeof value.nextCursor === "string"
    && /^[A-Za-z0-9_-]{1,512}$/u.test(value.nextCursor)))
  && Array.isArray(value.items) && value.items.length <= 20
  && value.items.every(validItem);

export default function IntegrationFailureQueue({
  environment, onSelect,
}: {
  readonly environment: string;
  readonly onSelect: (selection: FailureSelection | null) => void;
}) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [lookupSource, setLookupSource] = useState<FailureSource>("outbound_delivery");
  const [lookupId, setLookupId] = useState("");
  const [lookupInvalid, setLookupInvalid] = useState(false);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let active = true;
    // A detail selected from an older read/page must never remain visible.
    onSelect(null);
    setState({ kind: "loading" });
    const url = ENDPOINT + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" }, cache: "no-store",
        });
        if (response.status === 401 || response.status === 403) {
          if (active) setState({ kind: "denied" });
          return;
        }
        const json: unknown = response.ok ? await response.json() : null;
        if (active) setState(validPage(json) && json.environment === environment
          ? { kind: "ready", page: json } : { kind: "unknown" });
      } catch {
        if (active) setState({ kind: "unknown" });
      }
    })();
    return () => { active = false; };
  }, [environment, cursor, refreshSequence, onSelect]);
  return <div className="admin-audit-state" data-testid="unified-integration-failures">
    <h4>横断失敗キュー（ローカル送信・受信の2系統）</h4>
    <p>既存Outboxと受信Receiptの失敗を最終更新日時で並べます。
      外部Providerの障害履歴・外部ストレージ・署名検証前の拒否は含みません。
      0件でも正常とは限らず、このキューから再送・再処理はできません。</p>
    <button type="button" onClick={() => {
      onSelect(null);
      setCursors([null]);
      setRefreshSequence(value => value + 1);
    }}>失敗記録を更新</button>
    {state.kind === "loading" && <p role="status">失敗記録を取得中…</p>}
    {state.kind === "denied" && <p role="status">閲覧権限がありません</p>}
    {state.kind === "unknown" && <p role="status">両系統の失敗記録を取得できません（0件・正常とは判定しません）</p>}
    {state.kind === "ready" && <>
      <p data-testid="unified-queue-observed-at">キュー取得時点：{state.page.observedAt}（ローカル記録）</p>
      <form aria-label="記録IDから詳細確認" onSubmit={event => {
        event.preventDefault();
        const id = lookupId.trim();
        if (!idPattern.test(id)) {
          setLookupInvalid(true);
          onSelect(null);
          return;
        }
        setLookupInvalid(false);
        onSelect({ source: lookupSource, id });
      }}>
        <p>ログ等で把握したローカル記録IDから直接確認できます（Provider照合・再送はしません）。</p>
        <label htmlFor="unified-failure-lookup-source">記録の種類</label>
        <select id="unified-failure-lookup-source" value={lookupSource}
          onChange={event => { setLookupSource(event.target.value as FailureSource); setLookupInvalid(false); }}>
          <option value="outbound_delivery">送信Outbox</option>
          <option value="inbound_webhook">受信Webhook</option>
        </select>
        <label htmlFor="unified-failure-lookup-id">記録ID</label>
        <input id="unified-failure-lookup-id" type="text" autoComplete="off"
          maxLength={193} value={lookupId}
          onChange={event => { setLookupId(event.target.value); setLookupInvalid(false); }} />
        <button type="submit">指定IDの詳細を確認</button>
        {lookupInvalid && <p role="alert">ローカル記録IDの形式を確認してください</p>}
      </form>
      {state.page.items.length === 0
        ? <p>現在の対象記録は該当なし（Providerの正常性は未確認）</p>
        : <ul>{state.page.items.map(item => <li key={item.source + ":" + item.id}>
          <strong>{item.source === "outbound_delivery" ? "送信Outbox" : "受信Webhook"}</strong>
          {" "}<code>{item.id}</code>
          {item.providerKey ? " / " + item.providerKey : ""}
          {" / " + item.status + " / 試行 " + item.attemptCount
            + " 回 / " + item.failureCode + " / " + item.updatedAt}
          {" "}<button type="button"
            onClick={() => onSelect({ source: item.source, id: item.id })}>個別詳細を確認</button>
        </li>)}</ul>}
      <div className="admin-retry-actions">
        <button type="button" disabled={cursors.length === 1}
          onClick={() => { onSelect(null); setCursors(values => values.slice(0, -1)); }}>前の20件</button>
        <button type="button" disabled={!state.page.nextCursor}
          onClick={() => {
            if (state.page.nextCursor) {
              onSelect(null);
              setCursors(values => [...values, state.page.nextCursor]);
            }
          }}>次の20件</button>
      </div>
    </>}
  </div>;
}
