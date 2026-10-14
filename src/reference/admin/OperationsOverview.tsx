import { useEffect, useState } from "react";

/**
 * #414: bounded read-only projection from existing server-authorized APIs.
 * This is NOT a monitoring source of truth or an all-time audit aggregate.
 * Every unavailable or unconnected signal is explicit; zero observed rows
 * never means the entire environment is healthy.
 */
const SCOPE_ID = "workhub-company";
const params = (values: Record<string, string>): string => new URLSearchParams(values).toString();

interface JobSummary {
  readonly coverage: "environment";
  readonly environment: string;
  readonly observedAt: string;
  readonly counts: { readonly failed: number; readonly deadLetter: number };
}
interface OutboxSummary {
  readonly coverage: "environment";
  readonly environment: string;
  readonly observedAt: string;
  readonly counts: { readonly retryWait: number; readonly deadLetter: number };
  readonly watch: {
    readonly duePending: number;
    readonly dueRetryWait: number;
    readonly processing: number;
    readonly oldestProcessingUpdatedAt: string | null;
  };
  readonly attentionItems: readonly {
    readonly outboxId: string;
    readonly status: "pending" | "processing" | "retry_wait";
    readonly attemptCount: number;
    readonly updatedAt: string;
    readonly availableAt: string;
    readonly failureCode: string;
  }[];
  readonly sampleLimit: number;
  readonly items: readonly {
    readonly outboxId: string;
    readonly status: "retry_wait" | "dead_letter";
    readonly attemptCount: number;
    readonly updatedAt: string;
    readonly failureCode: string;
  }[];
}
interface FailedOutboxPage {
  readonly coverage: "environment";
  readonly environment: string;
  readonly observedAt: string;
  readonly pageLimit: 20;
  readonly items: OutboxSummary["items"];
  readonly nextCursor: string | null;
  readonly providerReceipt: "unverified";
}
interface OutboxDetail {
  readonly coverage: "environment";
  readonly environment: string;
  readonly observedAt: string;
  readonly outbox: {
    readonly outboxId: string;
    readonly status: "pending" | "processing" | "retry_wait" | "delivered" | "dead_letter";
    readonly attemptCount: number;
    readonly availableAt: string;
    readonly lastAttemptAt: string | null;
    readonly deliveredAt: string | null;
    readonly deadLetteredAt: string | null;
    readonly updatedAt: string;
    readonly version: number;
    readonly failureCode: string;
  };
  readonly decision: {
    readonly nextAction: "reconcile_external_first" | "await_scheduled_retry" | "observe_in_progress" | "queued" | "none";
    readonly providerOutcome: "unverified";
    readonly manualRetryAllowed: false;
    readonly operationGate: {
      readonly operationId: "DELIVERY_RETRY";
      readonly risk: "CONTROLLED_CHANGE" | "HUMAN_GATE";
      readonly policyDecision: "DENY";
      readonly policyVersion: "operations-policy-v1";
      readonly blocker: "provider_receipt_unverified";
      readonly executionAllowed: false;
    };
  };
}
interface AuditSnapshot {
  readonly items: readonly { readonly category: string; readonly action: string }[];
  readonly nextCursor: string | null;
}
interface MasterSnapshot {
  readonly environment: string;
  readonly asOf: string;
}
interface ReadinessSnapshot {
  readonly status: "ok" | "unavailable";
  readonly component: "database";
}
type Probe<T> =
  | { readonly kind: "ready"; readonly data: T }
  | { readonly kind: "denied" }
  | { readonly kind: "unknown" };

/** Consistent, read-only card projection; does not become a monitoring source of truth. */
type SourceState = "loading" | "available" | "denied" | "unknown" | "not_monitored";
type ObservationCoverage = "readiness" | "environment_current" | "bounded_sample" | "not_monitored";
interface OverviewCard {
  readonly title: string;
  readonly value: string;
  readonly sourceState: SourceState;
  readonly coverage: ObservationCoverage;
  readonly note: string;
  readonly href?: string;
}

interface OverviewSnapshot {
  readonly jobs: Probe<JobSummary>;
  readonly outbox: Probe<OutboxSummary>;
  readonly auditFailures: Probe<AuditSnapshot>;
  readonly privileged: Probe<AuditSnapshot>;
  readonly master: Probe<MasterSnapshot>;
  readonly database: Probe<ReadinessSnapshot>;
  readonly updatedAt: string;
}

const read = async <T,>(url: string, valid: (value: unknown) => value is T): Promise<Probe<T>> => {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (response.status === 401 || response.status === 403) return { kind: "denied" };
    // Readiness uses 503 with an explicit "unavailable" JSON contract.
    if (!response.ok && !(url === "/api/health/ready" && response.status === 503)) {
      return { kind: "unknown" };
    }
    const payload: unknown = await response.json();
    return valid(payload) ? { kind: "ready", data: payload } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasJobSummary = (value: unknown): value is JobSummary =>
  isRecord(value) && value.coverage === "environment"
  && typeof value.environment === "string"
  && typeof value.observedAt === "string"
  && isRecord(value.counts)
  && Number.isSafeInteger(value.counts.failed) && Number(value.counts.failed) >= 0
  && Number.isSafeInteger(value.counts.deadLetter) && Number(value.counts.deadLetter) >= 0
  && Number.isSafeInteger(Number(value.counts.failed) + Number(value.counts.deadLetter));
const hasOutboxSummary = (value: unknown): value is OutboxSummary =>
  isRecord(value) && value.coverage === "environment"
  && typeof value.environment === "string" && typeof value.observedAt === "string"
  && isRecord(value.counts)
  && Number.isSafeInteger(value.counts.retryWait) && Number(value.counts.retryWait) >= 0
  && Number.isSafeInteger(value.counts.deadLetter) && Number(value.counts.deadLetter) >= 0
  && Number.isSafeInteger(Number(value.counts.retryWait) + Number(value.counts.deadLetter))
  && isRecord(value.watch)
  && [value.watch.duePending, value.watch.dueRetryWait, value.watch.processing]
    .every((count) => Number.isSafeInteger(count) && Number(count) >= 0)
  && Number(value.watch.dueRetryWait) <= Number(value.counts.retryWait)
  && (value.watch.oldestProcessingUpdatedAt === null
    || typeof value.watch.oldestProcessingUpdatedAt === "string")
  && Number.isSafeInteger(value.sampleLimit) && Number(value.sampleLimit) >= 0
  && Array.isArray(value.items) && value.items.length <= Number(value.sampleLimit)
  && Array.isArray(value.attentionItems)
  && value.attentionItems.length <= Number(value.sampleLimit)
  && value.attentionItems.every((item: unknown) => isRecord(item)
    && typeof item.outboxId === "string" && item.outboxId.length <= 191
    && (item.status === "pending" || item.status === "processing" || item.status === "retry_wait")
    && Number.isSafeInteger(item.attemptCount) && Number(item.attemptCount) >= 0
    && typeof item.updatedAt === "string" && typeof item.availableAt === "string"
    && typeof item.failureCode === "string")
  && value.items.every((item: unknown) => isRecord(item)
    && typeof item.outboxId === "string" && item.outboxId.length <= 191
    && (item.status === "retry_wait" || item.status === "dead_letter")
    && Number.isSafeInteger(item.attemptCount) && Number(item.attemptCount) >= 0
    && typeof item.updatedAt === "string" && typeof item.failureCode === "string");
const safeFailureCodes = new Set([
  "event_missing", "delivery_exception", "retryable_failure", "permanent_failure",
  "provider_unavailable", "destination_disabled", "other",
]);
const hasFailedOutboxPage = (value: unknown): value is FailedOutboxPage =>
  isRecord(value) && value.coverage === "environment"
  && typeof value.environment === "string" && typeof value.observedAt === "string"
  && value.pageLimit === 20 && value.providerReceipt === "unverified"
  && (value.nextCursor === null || (typeof value.nextCursor === "string"
    && /^[A-Za-z0-9_-]{1,512}$/u.test(value.nextCursor)))
  && Array.isArray(value.items) && value.items.length <= 20
  && value.items.every((item: unknown) => isRecord(item)
    && typeof item.outboxId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u.test(item.outboxId)
    && (item.status === "retry_wait" || item.status === "dead_letter")
    && Number.isSafeInteger(item.attemptCount) && Number(item.attemptCount) >= 0
    && typeof item.updatedAt === "string" && item.updatedAt.length <= 64
    && Number.isFinite(Date.parse(item.updatedAt))
    && safeFailureCodes.has(String(item.failureCode)));
const hasOutboxDetail = (value: unknown): value is OutboxDetail =>
  isRecord(value) && value.coverage === "environment"
  && typeof value.environment === "string" && typeof value.observedAt === "string"
  && isRecord(value.outbox) && typeof value.outbox.outboxId === "string"
  && ["pending", "processing", "retry_wait", "delivered", "dead_letter"].includes(String(value.outbox.status))
  && Number.isSafeInteger(value.outbox.attemptCount) && Number(value.outbox.attemptCount) >= 0
  && Number.isSafeInteger(value.outbox.version) && Number(value.outbox.version) > 0
  && typeof value.outbox.availableAt === "string" && typeof value.outbox.updatedAt === "string"
  && typeof value.outbox.failureCode === "string"
  && [value.outbox.lastAttemptAt, value.outbox.deliveredAt, value.outbox.deadLetteredAt]
    .every((date) => date === null || typeof date === "string")
  && isRecord(value.decision)
  && ["reconcile_external_first", "await_scheduled_retry", "observe_in_progress", "queued", "none"]
    .includes(String(value.decision.nextAction))
  && value.decision.providerOutcome === "unverified"
  && value.decision.manualRetryAllowed === false
  && isRecord(value.decision.operationGate)
  && value.decision.operationGate.operationId === "DELIVERY_RETRY"
  && ["CONTROLLED_CHANGE", "HUMAN_GATE"].includes(String(value.decision.operationGate.risk))
  && value.decision.operationGate.policyDecision === "DENY"
  && value.decision.operationGate.policyVersion === "operations-policy-v1"
  && value.decision.operationGate.blocker === "provider_receipt_unverified"
  && value.decision.operationGate.executionAllowed === false;

const hasAudit = (value: unknown): value is AuditSnapshot =>
  isRecord(value) && Array.isArray(value.items)
  && value.items.every((item: unknown) => isRecord(item)
    && typeof item.category === "string" && typeof item.action === "string")
  && (value.nextCursor === null || typeof value.nextCursor === "string");
const hasMaster = (value: unknown): value is MasterSnapshot =>
  isRecord(value) && typeof value.environment === "string" && typeof value.asOf === "string";
const hasReadiness = (value: unknown): value is ReadinessSnapshot =>
  isRecord(value) && value.component === "database"
  && (value.status === "ok" || value.status === "unavailable");

/** Consume the server-owned cross-domain contract, never fabricate Healthy/0 on failure. */
const decodeProbe = <T,>(source: unknown, valid: (value: unknown) => value is T): Probe<T> => {
  if (!isRecord(source)) return { kind: "unknown" };
  if (source.kind === "denied") return { kind: "denied" };
  if (source.kind === "ready" && valid(source.data)) {
    return { kind: "ready", data: source.data };
  }
  return { kind: "unknown" };
};

const emptySnapshot = (kind: "denied" | "unknown"): OverviewSnapshot => ({
  jobs: { kind }, outbox: { kind }, auditFailures: { kind },
  privileged: { kind }, master: { kind }, database: { kind },
  updatedAt: new Date().toISOString(),
});

const snapshot = async (): Promise<OverviewSnapshot> => {
  try {
    const response = await fetch("/api/admin/operations/overview?" + params({ scopeId: SCOPE_ID }), {
      headers: { accept: "application/json" }, cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) return emptySnapshot("denied");
    if (!response.ok) return emptySnapshot("unknown");
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.schemaVersion !== 1 || payload.scopeId !== SCOPE_ID
      || typeof payload.updatedAt !== "string") return emptySnapshot("unknown");
    return {
      jobs: decodeProbe(payload.jobs, hasJobSummary),
      outbox: decodeProbe(payload.outbox, hasOutboxSummary),
      auditFailures: decodeProbe(payload.auditFailures, hasAudit),
      privileged: decodeProbe(payload.privileged, hasAudit),
      master: decodeProbe(payload.master, hasMaster),
      database: decodeProbe(payload.database, hasReadiness),
      updatedAt: payload.updatedAt,
    };
  } catch {
    return emptySnapshot("unknown");
  }
};

const unavailableLabel = (probe: Probe<unknown>): string =>
  probe.kind === "denied" ? "閲覧不可" : "取得できません";

const sourceState = (probe: Probe<unknown> | null): SourceState =>
  probe === null ? "loading"
    : probe.kind === "ready" ? "available" : probe.kind === "denied" ? "denied" : "unknown";

const jobCountLabel = (probe: Probe<JobSummary>): string => {
  if (probe.kind !== "ready") return unavailableLabel(probe);
  const total = probe.data.counts.failed + probe.data.counts.deadLetter;
  return Number.isSafeInteger(total) ? total + " 件（環境内の現在状態）" : "取得できません";
};

const outboxCountLabel = (probe: Probe<OutboxSummary>): string =>
  probe.kind === "ready"
    ? "要確認 " + probe.data.counts.deadLetter + " / 再試行待ち "
      + probe.data.counts.retryWait + " 件（環境内の現在状態）"
    : unavailableLabel(probe);

const auditCountLabel = (probe: Probe<AuditSnapshot>): string =>
  probe.kind === "ready"
    ? probe.data.items.length + (probe.data.nextCursor === null
      ? " 件（取得範囲）" : " 件以上（続きあり）")
    : unavailableLabel(probe);

const privilegedCountLabel = (probe: Probe<AuditSnapshot>): string =>
  probe.kind === "ready"
    ? probe.data.items.filter((event) => event.action.startsWith("operation.")).length
      + (probe.data.nextCursor === null ? " 件（直近system履歴内）" : " 件（直近system履歴内・続きあり）")
    : unavailableLabel(probe);

/** One view contract for every card, including sources not yet connected. */
const toCards = (ready: OverviewSnapshot | null): readonly OverviewCard[] => {
  const jobs = ready?.jobs ?? null;
  const outbox = ready?.outbox ?? null;
  const audit = ready?.auditFailures ?? null;
  const privileged = ready?.privileged ?? null;
  const db = ready?.database ?? null;
  const jobEnvironmentMismatch = ready?.jobs.kind === "ready"
    && ready.master.kind === "ready" && ready.jobs.data.environment !== ready.master.data.environment;
  const outboxEnvironmentMismatch = ready?.outbox.kind === "ready"
    && ready.master.kind === "ready" && ready.outbox.data.environment !== ready.master.data.environment;
  return [
    {
      title: "Database Readiness",
      value: db === null ? "取得中" : db.kind === "ready"
        ? db.data.status === "ok" ? "応答あり" : "接続異常" : unavailableLabel(db),
      sourceState: sourceState(db), coverage: "readiness",
      note: "アプリのDB Readiness応答。ジョブや外部連携の健全性は含みません。",
      href: "/api/health/ready",
    },
    {
      title: "失敗・Dead Letterジョブ",
      value: jobs === null ? "取得中" : jobEnvironmentMismatch ? "環境情報が不一致" : jobCountLabel(jobs),
      sourceState: jobEnvironmentMismatch ? "unknown" : sourceState(jobs),
      coverage: "environment_current",
      note: "環境内のfailed＋dead_letter現在件数をD1で集計。単一Scope構成専用、履歴全件数や処理全体の健全性ではありません。",
      href: "#admin-jobs-and-integrations",
    },
    {
      title: "監査失敗",
      value: audit === null ? "取得中" : auditCountLabel(audit),
      sourceState: sourceState(audit), coverage: "bounded_sample",
      note: "Scope内の失敗監査を新しい順に最大20件参照。続きがある場合も全期間件数とは区別します。",
      href: "#admin-audit-and-security",
    },
    {
      title: "直近の特権操作",
      value: privileged === null ? "取得中" : privilegedCountLabel(privileged),
      sourceState: sourceState(privileged), coverage: "bounded_sample",
      note: "直近system監査最大20件からoperation.*を抽出。全特権操作の件数ではありません。",
      href: "#admin-audit-and-security",
    },
    {
      title: "外部連携Outbox",
      value: outbox === null ? "取得中" : outboxEnvironmentMismatch
        ? "環境情報が不一致" : outboxCountLabel(outbox),
      sourceState: outboxEnvironmentMismatch ? "unknown" : sourceState(outbox),
      coverage: "environment_current",
      note: "WORKHUB単一Scopeの環境内Outbox記録。dead_letterは要確認、retry_waitは再試行待ち。0件でも外部Providerの正常性は保証しません。",
      href: "#admin-integration-outbox",
    },
    {
      title: "Metrics / Alert", value: "未接続",
      sourceState: "not_monitored", coverage: "not_monitored",
      note: "持続的なMetrics / Alert評価は未接続です。正常とは判定しません。",
    },
    {
      title: "Security Finding", value: "未接続",
      sourceState: "not_monitored", coverage: "not_monitored",
      note: "継続的なSecurity Findingの集計は未接続です。検出0件とは表示しません。",
    },
  ];
};

const StatusCard = ({ title, value, note, href, sourceState: state, coverage }: OverviewCard) =>
  <article className="admin-overview-card" data-source-state={state} data-coverage={coverage}>
    <h3>{title}</h3>
    <strong>{value}</strong>
    <p>{note}</p>
    {href && <a href={href}>詳細を確認 →</a>}
  </article>;

const actionLabel: Record<OutboxDetail["decision"]["nextAction"], string> = {
  reconcile_external_first: "外部サービス側の配送結果を照合してください。再送はまだできません。",
  await_scheduled_retry: "再試行予定を確認してください。手動の再送はできません。",
  observe_in_progress: "処理中です。時間経過だけで再送しないでください。",
  queued: "送信待ちです。送信処理の状態を確認してください。",
  none: "ローカル記録では配送済みです。外部側の受領は未照合です。",
};

const OutboxDetailPanel = ({ outboxId, environment }: { readonly outboxId: string; readonly environment: string }) => {
  const [detail, setDetail] = useState<Probe<OutboxDetail> | null>(null);
  useEffect(() => {
    let active = true;
    setDetail(null);
    void read("/api/admin/integrations/outbox/" + encodeURIComponent(outboxId) + "?"
      + params({ scopeId: SCOPE_ID }), hasOutboxDetail).then((result) => {
      if (active) setDetail(result.kind === "ready" && result.data.environment !== environment
        ? { kind: "unknown" } : result);
    });
    return () => { active = false; };
  }, [outboxId, environment]);
  return <div className="admin-audit-state" role="status" data-testid="outbox-detail">
    <h4>個別Outbox確認：<code>{outboxId}</code></h4>
    {detail === null ? <p>最新の状態を取得中…</p>
      : detail.kind !== "ready" ? <p>{unavailableLabel(detail)}。再試行はできません。</p>
        : <>
          <p>状態：{detail.data.outbox.status} / 試行回数：{detail.data.outbox.attemptCount}
            {" / Version: " + detail.data.outbox.version}</p>
          <p>再試行可能になる予定時刻：{detail.data.outbox.availableAt}
            {" / 最終試行：" + (detail.data.outbox.lastAttemptAt ?? "記録なし")}</p>
          <p>更新：{detail.data.outbox.updatedAt} / 診断コード：{detail.data.outbox.failureCode}</p>
          <p><strong>次の確認：</strong>{actionLabel[detail.data.decision.nextAction]}</p>
          <p>外部配送結果：未照合。再送可否は判断できません（この画面では再送しません）。</p>
          <p data-testid="outbox-operation-gate">
            共通Operations Core判定：<strong>再送禁止</strong>
            {"（リスク: " + detail.data.decision.operationGate.risk
              + " / Policy: " + detail.data.decision.operationGate.policyVersion + "）"}
            外部Providerの受領未確認のため、DELIVERY_RETRYは実行できません。
          </p>
          {detail.data.decision.nextAction === "reconcile_external_first" && (
            <section data-testid="outbox-reconcile-checklist" aria-label="照合手順">
              <h5>再送前の照合手順（操作・照合結果の登録機能は未実装）</h5>
              <ol>
                <li>外部Providerの配送履歴を、対象の配送ID・日時・宛先の管理された情報と突き合わせる。秘密情報はここへ入力しない。</li>
                <li>外部側で受領・処理済みか、未処理か、不明かを確認する。タイムアウトやUNKNOWNを未配送と決めつけない。</li>
                <li>結果が不明なら再送せず、運用担当者に調査を引き継ぐ。受領済みの場合も二重配送を避ける。</li>
                <li>確認結果・承認・監査証跡と冪等性が揃うまでは、共通Operations Core経由の再送申請も実行も行わない。</li>
              </ol>
              <p>この画面は参照専用です。Provider照合API・監査記録の保存・DELIVERY_RETRYの実行は提供していません。</p>
            </section>
          )}
        </>}
  </div>;
};

/** Browse local failed Outbox states beyond the eight-row overview sample. */
function FailedOutboxPages({ environment }: { readonly environment: string }) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [page, setPage] = useState<Probe<FailedOutboxPage> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    let active = true;
    setPage(null);
    setSelected(null);
    const query = params({ scopeId: SCOPE_ID, ...(cursor ? { cursor } : {}) });
    void read("/api/admin/integrations/outbox/_failures?" + query, hasFailedOutboxPage)
      .then(result => {
        if (active) setPage(result.kind === "ready" && result.data.environment !== environment
          ? { kind: "unknown" } : result);
      });
    return () => { active = false; };
  }, [environment, cursor]);
  return <div className="admin-audit-state" data-testid="failed-outbox-pages">
    <h4>失敗記録を20件ずつ確認（現在のOutbox状態のみ）</h4>
    <p>外部Providerの全失敗履歴ではありません。配送結果の受領照合・再送はできません。
      検索途中に配送状態が更新されると、ページ間の結果は変わる場合があります。</p>
    {page === null ? <p role="status">失敗記録を取得中…</p>
      : page.kind !== "ready" ? <p role="status">{unavailableLabel(page)}。0件や正常とは判定しません。</p>
      : <>
        {page.data.items.length === 0
          ? <p>該当する現在記録はありません（Providerの正常性は未確認）。</p>
          : <ul>{page.data.items.map(item => <li key={item.outboxId}>
            <code>{item.outboxId}</code> — {item.status} / 試行 {item.attemptCount} 回
            {" / " + item.failureCode + " / " + item.updatedAt}{" "}
            <button type="button" onClick={() => setSelected(item.outboxId)}>
              既存の個別詳細を確認
            </button>
          </li>)}</ul>}
        <div className="admin-retry-actions">
          <button type="button" disabled={cursors.length === 1}
            onClick={() => setCursors(values => values.slice(0, -1))}>前の20件</button>
          <button type="button" disabled={!page.data.nextCursor}
            onClick={() => {
              if (page.data.nextCursor) setCursors(values => [...values, page.data.nextCursor]);
            }}>次の20件</button>
        </div>
        {selected && page.data.items.some(item => item.outboxId === selected)
          ? <OutboxDetailPanel key={selected} outboxId={selected} environment={environment} /> : null}
      </>}
  </div>;
}

export default function OperationsOverview() {
  const [generation, setGeneration] = useState(0);
  const [selectedOutboxId, setSelectedOutboxId] = useState<string | null>(null);
  const [showFailedPages, setShowFailedPages] = useState(false);
  const [state, setState] = useState<
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly data: OverviewSnapshot }
  >({ kind: "loading" });

  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    void snapshot().then((data) => {
      if (current) setState({ kind: "ready", data });
    });
    return () => { current = false; };
  }, [generation]);

  const ready = state.kind === "ready" ? state.data : null;
  const cards = toCards(ready);
  const outboxSnapshot = ready?.outbox.kind === "ready"
    && !(ready.master.kind === "ready" && ready.outbox.data.environment !== ready.master.data.environment)
    ? ready.outbox.data : null;
  const environment = ready
    ? ready.master.kind === "ready" ? ready.master.data.environment : unavailableLabel(ready.master)
    : "取得中";

  return <section id="admin-operations-overview" className="admin-audit-panel admin-operations-overview"
    aria-labelledby="admin-operations-overview-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">OPERATIONS / READ-ONLY SNAPSHOT</p>
        <h2 id="admin-operations-overview-title">運用状況サマリー</h2>
        <p>既存の管理APIから要確認の兆候を表示します。失敗ジョブ・外部連携Outboxは環境内の現在件数、監査は直近20件の観測値です。継続監視の正本ではありません。</p>
      </div>
      <div className="admin-overview-refresh">
        <button type="button" disabled={state.kind === "loading"}
          onClick={() => { setSelectedOutboxId(null); setGeneration((value) => value + 1); }}>最新状態を確認</button>
        <small>{ready ? "取得日時: " + new Date(ready.updatedAt).toLocaleString("ja-JP") : "取得中…"}</small>
      </div>
    </div>
    <div className="admin-overview-grid" aria-label="運用状況の概要">
      {cards.map((item) => <StatusCard key={item.title} {...item} />)}
    </div>
    <section id="admin-integration-outbox" className="admin-overview-outbox" aria-label="外部連携の失敗記録">
      <h3>直近の外部連携失敗記録</h3>
      <p>Outboxに残っている失敗・再試行待ちの最新{outboxSnapshot?.sampleLimit ?? 8}件まで。Providerの稼働監視や配送履歴全件ではありません。</p>
      {outboxSnapshot && outboxSnapshot.items.length > 0
        ? <ul>{outboxSnapshot.items.map((item) => <li key={item.outboxId}>
          <code>{item.outboxId}</code> — {item.status === "dead_letter" ? "要確認" : "再試行待ち"}
          {" / 試行 " + item.attemptCount + " 回 / " + item.failureCode + " / " + item.updatedAt}
          {" "}<button type="button" onClick={() => setSelectedOutboxId(item.outboxId)}>状態と対応方針を確認</button>
        </li>)}</ul>
        : <p>{outboxSnapshot ? "該当する現在記録はありません（外部連携の正常性は未確認）。"
          : ready?.outbox.kind === "denied" ? "閲覧不可" : "取得できません／未確認"}</p>}
      {outboxSnapshot ? <>
        <button type="button" onClick={() => setShowFailedPages(value => !value)}>
          {showFailedPages ? "追加の失敗記録を閉じる" : "直近8件より前の失敗記録を確認"}
        </button>
        {showFailedPages && <FailedOutboxPages key={outboxSnapshot.environment}
          environment={outboxSnapshot.environment} />}
      </> : null}
      {outboxSnapshot ? <div data-testid="outbox-watch">
        <h4>未配送の確認候補（障害確定ではありません）</h4>
        <p>送信待ちで予定時刻到達：{outboxSnapshot.watch.duePending} 件
          {" / 再試行待ちで予定時刻到達：" + outboxSnapshot.watch.dueRetryWait + " 件"}
          {" / 処理中：" + outboxSnapshot.watch.processing + " 件"}
        </p>
        <p>処理中の最古更新：{outboxSnapshot.watch.oldestProcessingUpdatedAt ?? "該当なし"}。
          予定時刻到達は処理可能時刻に達したことだけを示します。
          処理中は異常や停止と断定できません。外部側の受領結果は未照合です。</p>
        {outboxSnapshot.attentionItems.length > 0
          ? <ul>{outboxSnapshot.attentionItems.map((item) => <li key={item.outboxId}>
            <code>{item.outboxId}</code> — {item.status === "processing" ? "処理中"
              : item.status === "pending" ? "送信待ち・予定時刻到達" : "再試行予定時刻到達"}
            {" / 最終更新 " + item.updatedAt + " / 予定 " + item.availableAt}
            {" "}<button type="button" onClick={() => setSelectedOutboxId(item.outboxId)}>状態と対応方針を確認</button>
          </li>)}</ul>
          : <p>確認候補はありません（外部連携の正常性を保証しません）。</p>}
      </div> : null}
      {selectedOutboxId && outboxSnapshot
        && [...outboxSnapshot.items, ...outboxSnapshot.attentionItems]
          .some((item) => item.outboxId === selectedOutboxId)
        ? <OutboxDetailPanel key={selectedOutboxId} outboxId={selectedOutboxId}
            environment={outboxSnapshot.environment} /> : null}
    </section>
    <p className="admin-overview-footnote" data-testid="operations-overview-environment">
      Server Environment: <strong>{environment}</strong> / Scope: {SCOPE_ID} / Application Version: 未提供
      {ready?.master.kind === "ready" ? " / Server As-Of: " + ready.master.data.asOf : ""}
    </p>
    <p className="admin-overview-footnote">ジョブ・Outbox集計はWORKHUB単一Scope環境内の状態別件数です（複数Scopeへ転用不可）。
      権限エラー・API障害・未監視は正常状態に変換しません。監査の取得範囲外や未接続領域に問題がないことは保証しません。</p>
  </section>;
}
