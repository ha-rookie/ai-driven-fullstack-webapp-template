import { useEffect, useState } from "react";

/**
 * #414: bounded read-only projection from existing server-authorized APIs.
 * This is NOT a monitoring source of truth or an all-time aggregate.
 * Every unavailable or unconnected signal is explicit; zero observed rows
 * never means the entire environment is healthy.
 */
const SCOPE_ID = "workhub-company";
const LIMIT = 20;
const params = (values: Record<string, string>): string => new URLSearchParams(values).toString();

interface JobSnapshot {
  readonly items: readonly { readonly state: string }[];
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

interface OverviewSnapshot {
  readonly failed: Probe<JobSnapshot>;
  readonly deadLetter: Probe<JobSnapshot>;
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

const hasItems = (value: unknown): value is JobSnapshot =>
  isRecord(value) && Array.isArray(value.items);
const hasAudit = (value: unknown): value is AuditSnapshot =>
  isRecord(value) && Array.isArray(value.items)
  && (value.nextCursor === null || typeof value.nextCursor === "string");
const hasMaster = (value: unknown): value is MasterSnapshot =>
  isRecord(value) && typeof value.environment === "string" && typeof value.asOf === "string";
const hasReadiness = (value: unknown): value is ReadinessSnapshot =>
  isRecord(value) && value.component === "database"
  && (value.status === "ok" || value.status === "unavailable");

const sourceUrl = {
  failed: "/api/admin/jobs?" + params({ scopeId: SCOPE_ID, state: "failed", limit: String(LIMIT) }),
  deadLetter: "/api/admin/jobs?" + params({ scopeId: SCOPE_ID, state: "dead_letter", limit: String(LIMIT) }),
  auditFailures: "/api/admin/audit?" + params({ scopeId: SCOPE_ID, outcome: "failure", limit: String(LIMIT) }),
  privileged: "/api/admin/audit?" + params({ scopeId: SCOPE_ID, category: "system", limit: String(LIMIT) }),
  master: "/api/admin/master-data?" + params({ scopeId: SCOPE_ID, masterKey: "workhub.office" }),
};

const snapshot = async (): Promise<OverviewSnapshot> => {
  const [failed, deadLetter, auditFailures, privileged, master, database] = await Promise.all([
    read(sourceUrl.failed, hasItems),
    read(sourceUrl.deadLetter, hasItems),
    read(sourceUrl.auditFailures, hasAudit),
    read(sourceUrl.privileged, hasAudit),
    read(sourceUrl.master, hasMaster),
    read("/api/health/ready", hasReadiness),
  ]);
  return { failed, deadLetter, auditFailures, privileged, master, database,
    updatedAt: new Date().toISOString() };
};

const unavailableLabel = (probe: Probe<unknown>): string =>
  probe.kind === "denied" ? "閲覧不可" : "取得できません";

const sampledJobLabel = (failed: Probe<JobSnapshot>, deadLetter: Probe<JobSnapshot>): string =>
  failed.kind === "ready" && deadLetter.kind === "ready"
    ? String(failed.data.items.length + deadLetter.data.items.length) + " 件（取得範囲）"
    : failed.kind === "denied" || deadLetter.kind === "denied"
      ? "閲覧不可" : "取得できません";

const StatusCard = ({ title, value, note, href }: {
  readonly title: string; readonly value: string;
  readonly note: string; readonly href?: string;
}) => <article className="admin-overview-card">
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
  const jobLabel = ready ? sampledJobLabel(ready.failed, ready.deadLetter) : "取得中";
  const auditFailureLabel = ready
    ? ready.auditFailures.kind === "ready"
      ? ready.auditFailures.data.items.length + " 件（取得範囲）"
      : unavailableLabel(ready.auditFailures)
    : "取得中";
  const privilegedLabel = ready
    ? ready.privileged.kind === "ready"
      ? ready.privileged.data.items.filter((event) => event.action.startsWith("operation.")).length
        + " 件（直近system履歴内）"
      : unavailableLabel(ready.privileged)
    : "取得中";
  const dbLabel = ready
    ? ready.database.kind === "ready"
      ? ready.database.data.status === "ok" ? "応答あり" : "接続異常"
      : unavailableLabel(ready.database)
    : "取得中";
  const environment = ready
    ? ready.master.kind === "ready" ? ready.master.data.environment : unavailableLabel(ready.master)
    : "取得中";

  return <section id="admin-operations-overview" className="admin-audit-panel admin-operations-overview"
    aria-labelledby="admin-operations-overview-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">OPERATIONS / READ-ONLY SNAPSHOT</p>
        <h2 id="admin-operations-overview-title">運用状況サマリー</h2>
        <p>既存の管理APIから取得した要確認の兆候です。件数は直近の取得範囲に限られ、監視・集計の正本ではありません。</p>
      </div>
      <div className="admin-overview-refresh">
        <button type="button" disabled={state.kind === "loading"}
          onClick={() => setGeneration((value) => value + 1)}>最新状態を確認</button>
        <small>{ready ? "取得日時: " + new Date(ready.updatedAt).toLocaleString("ja-JP") : "取得中…"}</small>
      </div>
    </div>
    <div className="admin-overview-grid" aria-label="運用状況の概要">
      <StatusCard title="Database Readiness" value={dbLabel}
        note="アプリのDB Readiness応答。ジョブや外部連携の健全性は含みません。"
        href="/api/health/ready" />
      <StatusCard title="失敗・Dead Letterジョブ" value={jobLabel}
        note="failed / dead_letterをそれぞれ最大20件取得。全件数・処理全体の正常性ではありません。"
        href="#admin-jobs-and-integrations" />
      <StatusCard title="監査失敗" value={auditFailureLabel}
        note="Scope内の失敗監査を新しい順に最大20件参照。全期間の集計ではありません。"
        href="#admin-audit-and-security" />
      <StatusCard title="直近の特権操作" value={privilegedLabel}
        note="直近system監査最大20件からoperation.*を抽出。全特権操作の件数ではありません。"
        href="#admin-audit-and-security" />
      <StatusCard title="連携・Metrics / Alert" value="未接続"
        note="Provider横断の連携失敗集計・メトリクス評価は接続されていません。正常とは判定しません。"
        href="#admin-jobs-and-integrations" />
      <StatusCard title="Security Finding" value="未接続"
        note="継続的なSecurity Findingの集計は未接続です。検出0件とは表示しません。" />
    </div>
    <p className="admin-overview-footnote" data-testid="operations-overview-environment">
      Server Environment: <strong>{environment}</strong> / Scope: {SCOPE_ID} / Application Version: 未提供
      {ready?.master.kind === "ready" ? " / Server As-Of: " + ready.master.data.asOf : ""}
    </p>
    <p className="admin-overview-footnote">権限エラー・API障害・未監視は正常状態として集計しません。
      件数0でも、取得範囲外の問題がないことは保証しません。</p>
  </section>;
}
