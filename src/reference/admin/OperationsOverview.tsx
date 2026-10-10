import { useEffect, useState } from "react";

/**
 * #414: bounded read-only projection from existing server-authorized APIs.
 * This is NOT a monitoring source of truth or an all-time audit aggregate.
 * Every unavailable or unconnected signal is explicit; zero observed rows
 * never means the entire environment is healthy.
 */
const SCOPE_ID = "workhub-company";
const LIMIT = 20;
const params = (values: Record<string, string>): string => new URLSearchParams(values).toString();

interface JobSummary {
  readonly coverage: "environment";
  readonly environment: string;
  readonly observedAt: string;
  readonly counts: { readonly failed: number; readonly deadLetter: number };
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

const sourceUrl = {
  jobs: "/api/admin/jobs/summary?" + params({ scopeId: SCOPE_ID }),
  auditFailures: "/api/admin/audit?" + params({ scopeId: SCOPE_ID, outcome: "failure", limit: String(LIMIT) }),
  privileged: "/api/admin/audit?" + params({ scopeId: SCOPE_ID, category: "system", limit: String(LIMIT) }),
  master: "/api/admin/master-data?" + params({ scopeId: SCOPE_ID, masterKey: "workhub.office" }),
};

const snapshot = async (): Promise<OverviewSnapshot> => {
  const [jobs, auditFailures, privileged, master, database] = await Promise.all([
    read(sourceUrl.jobs, hasJobSummary),
    read(sourceUrl.auditFailures, hasAudit),
    read(sourceUrl.privileged, hasAudit),
    read(sourceUrl.master, hasMaster),
    read("/api/health/ready", hasReadiness),
  ]);
  return { jobs, auditFailures, privileged, master, database,
    updatedAt: new Date().toISOString() };
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
  const audit = ready?.auditFailures ?? null;
  const privileged = ready?.privileged ?? null;
  const db = ready?.database ?? null;
  const jobEnvironmentMismatch = ready?.jobs.kind === "ready"
    && ready.master.kind === "ready" && ready.jobs.data.environment !== ready.master.data.environment;
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
      title: "連携・Metrics / Alert", value: "未接続",
      sourceState: "not_monitored", coverage: "not_monitored",
      note: "Provider横断の連携失敗集計・メトリクス評価は接続されていません。正常とは判定しません。",
      href: "#admin-jobs-and-integrations",
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

export default function OperationsOverview() {
  const [generation, setGeneration] = useState(0);
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
  const environment = ready
    ? ready.master.kind === "ready" ? ready.master.data.environment : unavailableLabel(ready.master)
    : "取得中";

  return <section id="admin-operations-overview" className="admin-audit-panel admin-operations-overview"
    aria-labelledby="admin-operations-overview-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">OPERATIONS / READ-ONLY SNAPSHOT</p>
        <h2 id="admin-operations-overview-title">運用状況サマリー</h2>
        <p>既存の管理APIから要確認の兆候を表示します。失敗ジョブは環境内の現在件数、監査は直近20件の観測値です。継続監視の正本ではありません。</p>
      </div>
      <div className="admin-overview-refresh">
        <button type="button" disabled={state.kind === "loading"}
          onClick={() => setGeneration((value) => value + 1)}>最新状態を確認</button>
        <small>{ready ? "取得日時: " + new Date(ready.updatedAt).toLocaleString("ja-JP") : "取得中…"}</small>
      </div>
    </div>
    <div className="admin-overview-grid" aria-label="運用状況の概要">
      {cards.map((item) => <StatusCard key={item.title} {...item} />)}
    </div>
    <p className="admin-overview-footnote" data-testid="operations-overview-environment">
      Server Environment: <strong>{environment}</strong> / Scope: {SCOPE_ID} / Application Version: 未提供
      {ready?.master.kind === "ready" ? " / Server As-Of: " + ready.master.data.asOf : ""}
    </p>
    <p className="admin-overview-footnote">ジョブ集計はWORKHUB単一Scope環境内の状態別件数です（複数Scopeへ転用不可）。
      権限エラー・API障害・未監視は正常状態に変換しません。監査の取得範囲外や未接続領域に問題がないことは保証しません。</p>
  </section>;
}
