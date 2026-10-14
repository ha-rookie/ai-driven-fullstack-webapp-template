import { useEffect, useState } from "react";

/**
 * #419 Stage7: status evidence for the existing local Outbox transport only.
 * Never infer third-party provider availability or delivery receipts from it.
 */
const SCOPE_ID = "workhub-company";
const URL = "/api/admin/integrations/outbox?scopeId=" + SCOPE_ID;

interface LocalEvidence {
  readonly kind: "local_outbox_state";
  readonly lastDeliveredUpdatedAt: string | null;
  readonly lastDeadLetterUpdatedAt: string | null;
  readonly providerReceipt: "unverified";
}
type ConnectionCapability = "outbound_delivery" | "inbound_webhook" | "external_document_storage";
interface ConnectionObservation {
  readonly capability: ConnectionCapability;
  readonly connectionState: "unknown";
  readonly monitoringState: "not_monitored";
  readonly providerCheckAt: null;
  readonly safeFailureCode: null;
}
interface ConnectionProjection {
  readonly schemaVersion: 1;
  readonly coverage: "capability_categories";
  readonly source: "no_provider_monitor_registered";
  readonly connections: readonly ConnectionObservation[];
}
interface Snapshot {
  readonly environment: string;
  readonly observedAt: string;
  readonly evidence: LocalEvidence;
  readonly connections: ConnectionProjection;
}
type State =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" | "unknown" }
  | { readonly kind: "ready"; readonly data: Snapshot };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.length <= 64
    && Number.isFinite(Date.parse(value)));

const connectionCapabilities: readonly ConnectionCapability[] = [
  "outbound_delivery", "inbound_webhook", "external_document_storage",
];
const connectionLabel: Readonly<Record<ConnectionCapability, string>> = {
  outbound_delivery: "外部配送",
  inbound_webhook: "受信Webhook",
  external_document_storage: "外部文書ストレージ",
};
/** No generic provider fields are accepted from untrusted HTTP JSON. */
const decodeConnections = (value: unknown): ConnectionProjection | null => {
  if (!record(value) || value.schemaVersion !== 1
    || value.coverage !== "capability_categories"
    || value.source !== "no_provider_monitor_registered"
    || !Array.isArray(value.connections)
    || value.connections.length !== connectionCapabilities.length) return null;
  const connections: ConnectionObservation[] = [];
  for (const capability of connectionCapabilities) {
    const item = value.connections.find((entry: unknown) =>
      record(entry) && entry.capability === capability);
    if (!record(item) || item.connectionState !== "unknown"
      || item.monitoringState !== "not_monitored"
      || item.providerCheckAt !== null || item.safeFailureCode !== null
      || value.connections.filter((entry: unknown) =>
        record(entry) && entry.capability === capability).length !== 1) return null;
    connections.push({
      capability, connectionState: "unknown", monitoringState: "not_monitored",
      providerCheckAt: null, safeFailureCode: null,
    });
  }
  return { schemaVersion: 1, coverage: "capability_categories",
    source: "no_provider_monitor_registered", connections };
};

const decode = (value: unknown): Snapshot | null => {
  if (!record(value) || value.coverage !== "environment"
    || typeof value.environment !== "string" || !value.environment
    || typeof value.observedAt !== "string" || !record(value.deliveryEvidence)) return null;
  const connections = decodeConnections(value.connectionStatus);
  if (connections === null) return null;
  const evidence = value.deliveryEvidence;
  if (evidence.kind !== "local_outbox_state" || evidence.providerReceipt !== "unverified"
    || !timestamp(evidence.lastDeliveredUpdatedAt)
    || !timestamp(evidence.lastDeadLetterUpdatedAt)) return null;
  return {
    environment: value.environment,
    observedAt: value.observedAt,
    connections,
    evidence: {
      kind: "local_outbox_state",
      lastDeliveredUpdatedAt: evidence.lastDeliveredUpdatedAt,
      lastDeadLetterUpdatedAt: evidence.lastDeadLetterUpdatedAt,
      providerReceipt: "unverified",
    },
  };
};

const dateLabel = (value: string | null): string =>
  value === null ? "該当する記録なし" : new Date(value).toLocaleString("ja-JP");

export default function IntegrationStatusPanel() {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const response = await fetch(URL, { cache: "no-store", headers: { accept: "application/json" } });
        if (response.status === 401 || response.status === 403) {
          if (active) setState({ kind: "denied" });
          return;
        }
        const data = response.ok ? decode(await response.json() as unknown) : null;
        if (active) setState(data ? { kind: "ready", data } : { kind: "unknown" });
      } catch {
        if (active) setState({ kind: "unknown" });
      }
    };
    void load();
    return () => { active = false; };
  }, [generation]);

  return <section className="admin-audit-panel" id="admin-integration-status"
    aria-labelledby="admin-integration-status-title" data-testid="integration-status">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">INTEGRATION / LOCAL EVIDENCE</p>
        <h2 id="admin-integration-status-title">外部連携の配送記録</h2>
        <p>Outboxの現在状態と最終更新時刻だけを確認します。外部Providerの接続状況や受領結果を検査する画面ではありません。</p>
      </div>
      <button type="button" disabled={state.kind === "loading"}
        onClick={() => setGeneration(value => value + 1)}>状態を再取得</button>
    </div>
    {state.kind === "loading" && <p role="status">取得中…</p>}
    {state.kind === "denied" && <p role="status">運用情報を閲覧する権限がありません</p>}
    {state.kind === "unknown" && <p role="status">配送記録は取得できません（正常とは判定しません）</p>}
    {state.kind === "ready" && <div data-testid="integration-local-evidence">
      <p>Environment: <strong>{state.data.environment}</strong> / 取得日時: {state.data.observedAt}</p>
      <p>配送完了状態の最終更新: <strong>{dateLabel(state.data.evidence.lastDeliveredUpdatedAt)}</strong></p>
      <p>Dead Letter状態の最終更新: <strong>{dateLabel(state.data.evidence.lastDeadLetterUpdatedAt)}</strong></p>
      <p>外部Providerの受領照合: <strong>未照合</strong>（Outboxの配送完了は、受信先での処理成功を保証しません）</p>
      <div data-testid="integration-connection-status" aria-label="Provider共通の接続観測状態">
        <h3>Provider共通の接続状態</h3>
        <p>現在はProvider監視が未接続です。接続成功・障害なし・外部受領成功を意味しません。</p>
        <ul>{state.data.connections.connections.map(item =>
          <li key={item.capability} data-connection-capability={item.capability}>
            {connectionLabel[item.capability]}：<strong>未監視</strong>（接続状態：不明）
          </li>)}</ul>
        <p>外部文書ストレージの実Provider Adapterは#335の後続実装です。</p>
      </div>
      <a href="#admin-integration-outbox">失敗記録と個別の確認方針へ移動 →</a>
    </div>}
  </section>;
}
