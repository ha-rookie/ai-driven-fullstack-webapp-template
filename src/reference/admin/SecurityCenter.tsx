import { useEffect, useState } from "react";
import { normalizeSecuritySourceCoverage, SECURITY_SEVERITIES, SECURITY_CATEGORIES, SECURITY_STATUSES, type SecuritySourceCoverage, type SecuritySeverity, type SecurityCategory, type SecurityFindingStatus } from "../../shared/security/security-finding";
import { isSecurityFindingFeed, selectSecurityFindings, type SecurityFindingFeed } from "../../shared/security/security-finding-view";
import { scsTestSourceLinks } from "../../shared/security/scs-reference-links";
import { classifySecurityCi } from "../../shared/security/security-ci-triage";

const SCOPE = "workhub-company";
const SOURCES = ["secret_detection", "dependency_audit", "configuration_check", "scs_control_mapping"];
const REPOSITORY = "ha-rookie/ai-driven-fullstack-webapp-template";
type CiRun = {
  readonly runId: number; readonly targetSha: string; readonly updatedAt: string;
  readonly checkStatus: "queued" | "in-progress" | "completed";
  readonly checkConclusion?: "success" | "failure" | "cancelled" | "skipped" | "timed-out" | "neutral" | "action-required";
  readonly event: "pull_request" | "pull_request_target" | "push" | "schedule" | "workflow_dispatch";
};
type Coverage = SecuritySourceCoverage & {
  readonly ci: {
    readonly state: "not-connected" | "available" | "unavailable";
    readonly fetchedAt: string | null; readonly latest: CiRun | null;
    readonly latestSuccessfulRun: CiRun | null;
  };
};
type Requirement = {
  readonly id: string; readonly level: string; readonly name: string;
  readonly responsibility: string; readonly control: string;
  readonly testReference: string | null; readonly evidenceReference: string | null;
  readonly evidenceFreshness: "current" | "stale" | "unknown";
  readonly finding: null; readonly remediation: null;
};
interface Snapshot {
  readonly schemaVersion: 1; readonly scopeId: string; readonly observedAt: string;
  readonly posture: "not-assessed";
  readonly findings: SecurityFindingFeed;
  readonly sources: readonly Coverage[];
  readonly scs: {
    readonly sourceVerifiedAt: string; readonly certification: "not-assessed";
    readonly requirements: readonly Requirement[];
  };
}
const isTime = (value: unknown): value is string => typeof value === "string"
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const isRun = (value: unknown, asOf: string): value is CiRun => {
  if (!value || typeof value !== "object") return false;
  const run = value as CiRun;
  return Number.isSafeInteger(run.runId) && run.runId > 0
    && typeof run.targetSha === "string" && /^[a-f0-9]{40}$/u.test(run.targetSha)
    && isTime(run.updatedAt) && run.updatedAt <= asOf
    && ["pull_request", "pull_request_target", "push", "schedule", "workflow_dispatch"].includes(run.event)
    && (run.checkStatus === "completed"
      ? ["success", "failure", "cancelled", "skipped", "timed-out", "neutral", "action-required"].includes(run.checkConclusion ?? "")
      : ["queued", "in-progress"].includes(run.checkStatus) && run.checkConclusion === undefined);
};
const validCoverage = (value: unknown, observedAt: string): value is Coverage => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Coverage;
  if (!SOURCES.includes(source.sourceId)) return false;
  const coverage: Record<string, unknown> = { ...source };
  delete coverage.freshness;
  delete coverage.ci;
  try {
    const normalized = normalizeSecuritySourceCoverage(coverage, observedAt);
    return normalized.freshness === source.freshness && normalized.checkedFindingCount === source.checkedFindingCount;
  } catch { return false; }
};
const isSource = (source: Coverage, observedAt: string): boolean => {
  if (!validCoverage(source, observedAt)) return false;
  const ci = source.ci;
  if (!ci) return false;
  if (ci.state === "not-connected") return ci.fetchedAt === null && ci.latest === null
    && ci.latestSuccessfulRun === null;
  if (!isTime(ci.fetchedAt) || ci.fetchedAt > observedAt) return false;
  if (ci.state === "unavailable") return ci.latest === null && ci.latestSuccessfulRun === null
    && source.coverageState === "unavailable" && source.sourceHealth === "unavailable";
  if (ci.state !== "available" || (ci.latest !== null && !isRun(ci.latest, ci.fetchedAt))
    || (ci.latestSuccessfulRun !== null && (!isRun(ci.latestSuccessfulRun, ci.fetchedAt)
      || ci.latestSuccessfulRun.checkStatus !== "completed" || ci.latestSuccessfulRun.checkConclusion !== "success"))) return false;
  if (ci.latest === null && ci.latestSuccessfulRun !== null) return false;
  if (ci.latest?.checkStatus === "completed" && ci.latest.checkConclusion === "success"
    && (ci.latestSuccessfulRun?.runId !== ci.latest.runId
      || ci.latestSuccessfulRun?.targetSha !== ci.latest.targetSha)) return false;
  if (ci.latest && ci.latestSuccessfulRun && ci.latestSuccessfulRun.updatedAt > ci.latest.updatedAt) return false;
  const failed = ci.latest?.checkStatus === "completed" && ci.latest.checkConclusion !== "success" && ci.latest.checkConclusion !== "skipped";
  return !failed || (source.coverageState === "unavailable" && source.sourceHealth === "unavailable");
};
const isSnapshot = (value: unknown): value is Snapshot => {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<Snapshot>;
  return v.schemaVersion === 1 && v.scopeId === SCOPE && v.posture === "not-assessed"
    && isTime(v.observedAt)
    && Array.isArray(v.sources) && v.sources.length === 4
    && new Set(v.sources.map(s => s?.sourceId)).size === SOURCES.length
    && v.sources.every(s => isSource(s, v.observedAt!))
    && isSecurityFindingFeed(v.findings, v.sources, v.observedAt!)
    && v.scs?.certification === "not-assessed"
    && Array.isArray(v.scs.requirements)
    && v.scs.requirements.every((r) => typeof r.id === "string"
      && typeof r.name === "string" && typeof r.responsibility === "string"
      && typeof r.control === "string" && r.evidenceFreshness === "unknown");
};

/** A verified source-bound zero is not a whole-system security verdict. */
const coverageDisplay = (source: Coverage) => {
  if (source.coverageState === "unavailable") return { label: "利用不可（Gray）", count: "不明" };
  if (source.coverageState !== "checked") return {
    label: source.coverageState === "not-applicable" ? "対象外（Gray）" : "未検査（Gray）", count: "不明",
  };
  const expired = source.evidenceValidUntil !== undefined && Date.parse(source.evidenceValidUntil) < Date.now();
  if (source.freshness === "stale" || expired) return {
    label: "証跡期限切れ（Gray）", count: `${source.checkedFindingCount}件（過去の検査値）`,
  };
  if (source.freshness !== "current") return {
    label: "証跡鮮度不明（Gray）", count: `${source.checkedFindingCount}件（鮮度不明）`,
  };
  return { label: "当該ソース確認済（全体の安全判定ではない）", count: `${source.checkedFindingCount}件（当該ソースのみ）` };
};

/** Registered file paths are navigation hints, not successful tests or evidence. */
const ScsTestReferences = ({ reference }: { readonly reference: string | null }) => {
  const links = scsTestSourceLinks(reference);
  return <div className="scs-test-references">
    {links.length > 0 ? links.map((link) => <a key={link.path} href={link.href}
      target="_blank" rel="noopener noreferrer">{link.path}</a>)
      : reference ? "参照形式未対応（リンクなし）" : "未登録"}
  </div>;
};

/** Status of CI only; never the verified Finding health or SCS status. */
const CiExecutionStatus = ({ source }: { readonly source: Coverage }) => {
  const triage = classifySecurityCi(source.ci);
  return <div><strong>{triage.label}</strong>
    <small>{triage.history}</small>
    {source.ci.state === "available" && source.ci.latest && <>
      <span>{source.ci.latest.checkStatus} / {source.ci.latest.checkConclusion ?? "未完了"}</span>
      <RunReference run={source.ci.latest} />
    </>}
    {source.ci.state === "available" && !source.ci.latest && <span>実行記録なし（not-run）</span>}
  </div>;
};

/** Step codes are tied to fixed server-owned Workflow policies, not arbitrary response text. */
const STEP_CODES: Record<string, string> = {
  secret_detection: "secret_scan",
  dependency_audit: "dependency_production_audit",
  configuration_check: "configuration_validation_self_test",
  scs_control_mapping: "scs_mapping_validation",
};
type StepEvidence = {
  readonly schemaVersion: 1; readonly sourceId: string; readonly stepCode: string;
  readonly runId: number | null; readonly targetSha: string | null;
  readonly state: "observed" | "unavailable" | "not-run";
  readonly conclusion: CiRun["checkConclusion"] | null;
};
const matchesStep = (input: unknown, source: Coverage): input is StepEvidence => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const v = input as Partial<StepEvidence>;
  const latest = source.ci.latest;
  const outcomes = ["success", "failure", "cancelled", "skipped", "timed-out", "neutral", "action-required"];
  return v.schemaVersion === 1 && v.sourceId === source.sourceId
    && v.stepCode === STEP_CODES[source.sourceId]
    && (v.runId === latest?.runId) && (v.targetSha === latest?.targetSha)
    && (v.state === "observed" ? outcomes.includes(v.conclusion ?? "")
      : (v.state === "unavailable" || v.state === "not-run") && v.conclusion === null);
};
const CiStepEvidence = ({ source }: { readonly source: Coverage }) => {
  const [result, setResult] = useState<
    { readonly kind: "idle" | "loading" | "unavailable" }
    | { readonly kind: "ready"; readonly data: StepEvidence }
  >({ kind: "idle" });
  const latest = source.ci.latest;
  if (source.ci.state !== "available" || !latest || latest.checkStatus !== "completed") {
    return <span>検査ステップは未照合（最新の完了Runなし）</span>;
  }
  const load = async () => {
    setResult({ kind: "loading" });
    try {
      const response = await fetch(
        `/api/admin/security/center?scopeId=${encodeURIComponent(SCOPE)}&sourceId=${encodeURIComponent(source.sourceId)}`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      if (!response.ok) { setResult({ kind: "unavailable" }); return; }
      const value: unknown = await response.json();
      setResult(matchesStep(value, source) ? { kind: "ready", data: value } : { kind: "unavailable" });
    } catch { setResult({ kind: "unavailable" }); }
  };
  return <div>
    <button type="button" onClick={() => { void load(); }}
      disabled={result.kind === "loading"}>検査ステップを確認</button>
    {result.kind === "loading" && <small role="status">検査ステップ照会中…</small>}
    {result.kind === "unavailable" && <small role="alert">検査ステップの照合に失敗。Run/SHA変更または取得不能。未確認扱いです。</small>}
    {result.kind === "ready" && <small data-testid={`security-step-${source.sourceId}`}>
      {result.data.state === "observed"
        ? `GitHub CIステップ: ${result.data.conclusion}（Run #${result.data.runId}・SHA ${result.data.targetSha?.slice(0,12)}、Finding結果ではありません）`
        : "検査ステップを確認できません（未検証）"}
    </small>}
  </div>;
};

const RunReference = ({ run }: { readonly run: CiRun }) => <>
  <a href={`https://github.com/${REPOSITORY}/actions/runs/${run.runId}`} target="_blank" rel="noopener noreferrer">Run #{run.runId}</a>
  <small title={run.targetSha}>SHA {run.targetSha.slice(0, 12)} / {run.event}</small>
  <small><time dateTime={run.updatedAt}>{run.updatedAt}</time>（更新日時）</small>
</>;

export default function SecurityCenter() {
  const [state, setState] = useState<
    { readonly kind: "loading" | "denied" | "unavailable" }
    | { readonly kind: "ready"; readonly data: Snapshot }
  >({ kind: "loading" });
  const [filter, setFilter] = useState("");
  const [ciAttentionOnly, setCiAttentionOnly] = useState(false);
  const [findingSeverity, setFindingSeverity] = useState<SecuritySeverity | "all">("all");
  const [findingCategory, setFindingCategory] = useState<SecurityCategory | "all">("all");
  const [findingStatus, setFindingStatus] = useState<SecurityFindingStatus | "all">("all");
  const load = async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/admin/security/center?scopeId=${encodeURIComponent(SCOPE)}`, {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        setState({ kind: "denied" }); return;
      }
      if (!response.ok) { setState({ kind: "unavailable" }); return; }
      const payload: unknown = await response.json();
      setState(isSnapshot(payload) ? { kind: "ready", data: payload } : { kind: "unavailable" });
    } catch { setState({ kind: "unavailable" }); }
  };
  useEffect(() => { void load(); }, []);
  const ready = state.kind === "ready" ? state.data : null;
  const ciAttentionCount = ready?.sources.filter((source) => classifySecurityCi(source.ci).needsAttention).length ?? 0;
  const visibleCiSources = ready?.sources.filter((source) => !ciAttentionOnly
    || classifySecurityCi(source.ci).needsAttention) ?? [];
  const visibleFindings = ready?.findings.state === "verified"
    ? selectSecurityFindings(ready.findings.items, {
      severity: findingSeverity, category: findingCategory, status: findingStatus,
    }) : [];
  const requirements = ready?.scs.requirements.filter((r) =>
    `${r.id} ${r.name} ${r.responsibility}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? [];
  return <section className="admin-audit-panel" id="admin-security-center" aria-labelledby="admin-security-center-title">
    <div className="admin-audit-heading"><div>
      <p className="admin-eyebrow">SECURITY / SELF-AUDIT CENTER</p>
      <h2 id="admin-security-center-title">セキュリティ確認センター</h2>
      <p>実際の検査結果と未接続の検査を分けて確認します。監査ログは操作履歴であり、脆弱性Findingではありません。</p>
    </div><div className="admin-audit-scope"><span>Scope</span><strong>{SCOPE}</strong></div></div>
    {state.kind === "loading" && <p role="status">セキュリティ状態を確認しています…</p>}
    {state.kind === "denied" && <p role="alert">このSecurity Centerの参照権限がありません。</p>}
    {state.kind === "unavailable" && <div role="alert"><strong>状態を取得できませんでした</strong>
      <p>未取得を「問題なし」とは扱いません。</p><button type="button" onClick={() => { void load(); }}>再試行</button></div>}
    {ready && <>
      <div className="admin-audit-state" data-testid="security-center-posture">
        <strong>判定：未評価（Gray）</strong>
        <p>{ready.findings.state === "not-connected"
          ? "Finding検証結果未接続／件数は不明。0件・安全・SCS適合を意味しません。"
          : "照合済みFindingは対象ソースのみに限定。全体の安全・SCS適合・証跡鮮度を意味しません。"}</p>
      </div>
      <h3>検査ソースと証跡の鮮度</h3>
      <p>CIは公開Repositoryの各Workflowから最大5 Runを取得します。対象SHA・起点・取得日時を確認してください。
        CI成功はFinding 0件や証跡の鮮度を証明せず、現在のmain・稼働アプリと同一コードである保証もありません。</p>
      <p>CI成功Runの日時は、取得した5件内で成功したRunの更新日時です。全履歴の最終成功・検査完了時刻・Finding最終検証日時とは区別します。
        キャッシュは最大5分。Local/Testでは外部CIを取得しません。検査ステップ照会は選択した最新Runのみ、ボタン操作で取得します。成功してもFindingゼロやSCS適合を意味しません。</p>
      <label><input type="checkbox" checked={ciAttentionOnly}
        onChange={(event) => setCiAttentionOnly(event.target.checked)} /> CI要確認のソースのみ表示</label>
      <p role="status">CI要確認 {ciAttentionCount} / {ready.sources.length} ソース。CI成功もFinding評価・SCS適合を意味しません。</p>
      <div className="admin-audit-table-wrap"><table className="admin-audit-table">
        <thead><tr><th>検査ソース</th><th>CI実行状態・対象SHA</th><th>検査ステップの実確認（オンデマンド）</th><th>CI成功Run（直近5件内）</th><th>取得日時</th>
          <th>Finding評価状態</th><th>Finding Health</th><th>Finding最終検証</th><th>Evidence freshness</th><th>Finding件数</th></tr></thead>
        <tbody>{visibleCiSources.map((source) => <tr key={source.sourceId} data-testid={`security-source-${source.sourceId}`}>
          <td>{source.sourceId}</td>
          <td><CiExecutionStatus source={source} /></td><td><CiStepEvidence source={source} /></td>
          <td>{source.ci.latestSuccessfulRun ? <RunReference run={source.ci.latestSuccessfulRun} />
            : source.ci.state === "available" ? "取得範囲に成功Runなし" : "未取得"}</td>
          <td>{source.ci.fetchedAt ?? "未取得"}</td><td>{coverageDisplay(source).label}</td>
          <td>{source.sourceHealth}</td><td>{source.lastSuccessfulCheckAt ?? "未取得"}</td>
          <td>{source.freshness}</td><td>{coverageDisplay(source).count}</td>
        </tr>)}</tbody>
      </table></div>
      <h3>Security Finding（検査済みソース限定）</h3>
      {ready.findings.state === "not-connected" ? <p data-testid="security-finding-unconnected">
        Findingデータ提供元は未接続。件数は不明、重大度・対応状態は評価していません。
      </p> : <>
        <p role="status">検査済みソースのFinding {ready.findings.verifiedCount} 件。
          全システムでの件数、現在の安全性・SCS適合や証跡鮮度は保証されません。</p>
        <div>
          <label>Finding重大度 <select aria-label="Finding重大度"
            value={findingSeverity} onChange={event => setFindingSeverity(event.target.value as SecuritySeverity | "all")}>
            <option value="all">すべて</option>
            {SECURITY_SEVERITIES.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>Finding分類 <select aria-label="Finding分類"
            value={findingCategory} onChange={event => setFindingCategory(event.target.value as SecurityCategory | "all")}>
            <option value="all">すべて</option>
            {SECURITY_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>Finding状態 <select aria-label="Finding状態"
            value={findingStatus} onChange={event => setFindingStatus(event.target.value as SecurityFindingStatus | "all")}>
            <option value="all">すべて</option>
            {SECURITY_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
        </div>
        <p>Finding表示 {visibleFindings.length} / {ready.findings.verifiedCount} 件。
          証跡とRemediationは許可済みコードのみ。外部URL・生ログ・承認操作はありません。</p>
        <div className="admin-audit-table-wrap"><table className="admin-audit-table" data-testid="security-findings-table">
          <thead><tr><th>Rule / Source</th><th>Severity / Category</th><th>Status / Risk exception</th>
            <th>Evidence（コード・参照IDのみ）</th><th>Remediation（コードのみ）</th></tr></thead>
          <tbody>{visibleFindings.map(item => <tr key={`${item.sourceId}:${item.ruleId}:${item.resourceRef ?? ""}`}>
            <td>{item.ruleId}<small>{item.sourceId}</small></td>
            <td>{item.severity} / {item.category}</td>
            <td>{item.status} / {item.riskDisposition === "accepted-expired"
              ? "例外期限切れ（承認無効）" : item.riskDisposition === "accepted-current"
                ? "期限内の承認記録あり（再確認要）" : "例外なし"}</td>
            <td>{item.evidence.map((evidence, i) => <div key={i}>
              {evidence.kind} / {evidence.code} / {evidence.referenceId ?? "参照ID未登録"}
            </div>)}</td>
            <td>{item.remediationCode ?? "対応コード未登録"}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
      <h3>SCS要件別の責任・Control・証跡</h3>
      <p>既存要件対応表の参照元確認日：{ready.scs.sourceVerifiedAt}。これは各要件の監査・証跡の最終確認日ではありません。検査実行やSCS認証取得を示しません。</p>
      <p>テストファイルのリンクは登録済みソースへの案内です。リンク先は閲覧時点のGitHub mainで、稼働アプリ・CI実行対象SHAとは限りません。テスト成功や証跡の存在・鮮度を確認したものではありません。</p>
      <label>要件・責任を検索 <input value={filter} onChange={(event) => setFilter(event.target.value)}
        placeholder="例：3-1-1、Project Responsibility" /></label>
      <div className="admin-audit-table-wrap"><table className="admin-audit-table">
        <thead><tr><th>Requirement</th><th>Responsibility</th><th>Control</th><th>Test source / Evidence（参照のみ・未検証）</th><th>Freshness</th><th>Finding / Remediation</th></tr></thead>
        <tbody>{requirements.map((r) => <tr key={r.id}>
          <td><strong>{r.id}</strong><small>{r.name}</small></td><td>{r.responsibility}</td>
          <td>{r.control}</td><td><ScsTestReferences reference={r.testReference} />
            <div>証跡名：{r.evidenceReference ?? "未登録"}（未検証）</div></td>
          <td>未検証（{r.evidenceFreshness}）</td><td>未接続 / 未接続</td>
        </tr>)}</tbody>
      </table></div>
      <p>表示 {requirements.length} / {ready.scs.requirements.length} 要件。SeverityはFinding、SCS statusは要件別の責任・実装状態であり、別の評価軸です。</p>
      <p><a href="#admin-audit-and-security">操作監査ログを別画面で確認</a></p>
    </>}
  </section>;
}
