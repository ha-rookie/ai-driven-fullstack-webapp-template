import { useEffect, useRef, useState } from "react";
import { normalizeSecurityFinding, normalizeSecuritySourceCoverage, SECURITY_SEVERITIES, SECURITY_CATEGORIES, SECURITY_STATUSES, type SecurityFinding, type SecuritySourceCoverage, type SecuritySeverity, type SecurityCategory, type SecurityFindingStatus } from "../../shared/security/security-finding";
import { assessFindingEvidence, assessFindingSourceLineage, getFindingTriageRoute, isSecurityFindingFeed, readVerifiedAuditRequestMatch, correlateFindingAuditResource, selectSecurityFindings, type AuditRequestLookupEvidence, type SecurityFindingFeed } from "../../shared/security/security-finding-view";
import { assessScsEvidenceCandidateFreshness, scsFullCiEvidenceEligible, scsTestSourceLinks, scsOsvTechnicalEvidenceTrace, scsRequirementEvidencePath, scsReviewedCiStepSource } from "../../shared/security/scs-reference-links";
import { classifySecurityCi } from "../../shared/security/security-ci-triage";
import runtimeInventory from "../../../config/security-runtime-dependency-inventory.json";

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
  return !failed || (source.coverageState === "unavailable" && source.sourceHealth === "unavailable")
    || (ci.latest?.checkConclusion === "failure" && source.coverageState === "checked"
      && source.sourceHealth === "degraded" && source.checkedFindingCount === 1);
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

/** Check that the on-demand CI feed contains only run-bound, known control-step failures. */
const isObservedControlSnapshot = (value: unknown): value is Snapshot => {
  if (!isSnapshot(value)) return false;
  if (value.findings.state === "not-connected") return true;
  const checked = value.sources.filter(source => source.coverageState === "checked");
  return checked.length === value.findings.items.length
    && value.findings.items.length > 0
    && value.findings.items.every(finding => {
      const source = checked.find(item => item.sourceId === finding.sourceId);
      const run = source?.ci.latest;
      const category = finding.sourceId === "dependency_audit" ? "dependency"
        : finding.sourceId === "secret_detection" ? "data" : "configuration";
      const severity = finding.sourceId === "dependency_audit" || finding.sourceId === "secret_detection"
        ? "high" : "medium";
      return run?.checkStatus === "completed" && run.checkConclusion === "failure"
        && finding.ruleId === "ci_step_failure" && finding.category === category
        && finding.severity === severity && finding.status === "open"
        && finding.resourceRef === "commit_" + run.targetSha.slice(0, 12)
        && finding.detectedAt === run.updatedAt && finding.lastObservedAt === run.updatedAt
        && finding.assessedAt === value.observedAt && finding.riskDisposition === "none"
        && finding.remediationCode === "review_control" && !finding.auditRequestId
        && finding.evidence.length === 1 && finding.evidence[0].kind === "ci"
        && finding.evidence[0].code === "control_check_failed"
        && finding.evidence[0].referenceId === "run_" + run.runId;
    });
};


type OsvSnapshot = Snapshot & { dependencyScope: {
  state: "verified"; checkedPackages: number; checkedAt: string;
  advisoryCount: number; advisories: readonly {packageRef:string;advisoryId:string}[];
} | { state: "unavailable"; checkedPackages:null; checkedAt:null; advisoryCount:null; advisories:null } };
const isOsvFindingSnapshot = (value: Snapshot): value is OsvSnapshot => {
  const scope = (value as Snapshot & {dependencyScope?: OsvSnapshot["dependencyScope"]}).dependencyScope;
  if (!scope) return false;
  if (scope.state === "unavailable") return value.findings.state === "not-connected";
  if (scope.state !== "verified" || scope.checkedPackages !== 12
    || !isTime(scope.checkedAt) || scope.checkedAt > value.observedAt
    || Date.parse(value.observedAt) - Date.parse(scope.checkedAt) >= 300_000
    || !Array.isArray(scope.advisories) || scope.advisories.length !== scope.advisoryCount
    || value.findings.state !== "verified") return false;
  const items = value.findings.items;
  if (items.length !== scope.advisories.length) return false;
  return scope.advisories.every((a, i) => {
    const finding = items[i];
    return /^pkg_[0-9]{2}$/u.test(a.packageRef)
      && /^(?:GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-[0-9]{4}-[0-9]{4,}|OSV-[0-9]{4}-[0-9]+)$/u.test(a.advisoryId)
      && finding.ruleId === "osv_advisory_" + i && finding.sourceId === "dependency_audit"
      && finding.resourceRef === a.packageRef && finding.category === "dependency"
      && finding.severity === "info" && finding.status === "open"
      && finding.detectedAt === scope.checkedAt && finding.lastObservedAt === scope.checkedAt
      && finding.assessedAt === value.observedAt
      && finding.evidence.length === 1 && finding.evidence[0].kind === "dependency"
      && finding.evidence[0].code === "dependency_alert"
      && finding.remediationCode === "update_dependency";
  });
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

/** Actual source observation state for a single finding, not a system security score. */
const FindingEvidenceStatus = ({
  finding, sources, now,
}: { readonly finding: SecurityFinding; readonly sources: readonly Coverage[]; readonly now: string }) => {
  const status = assessFindingEvidence(finding, sources, now);
  const lineage = assessFindingSourceLineage(finding, sources, now);
  const freshnessLabel = status.state === "current" ? "期限内（ソース限定）"
    : status.state === "stale" ? "期限切れ（Gray／再照会要）"
      : status.state === "unavailable" ? "取得不能（Gray）" : "未確認（Gray）";
  return <div data-testid={`finding-evidence-status-${finding.ruleId}`}>
    <strong>技術証跡：{freshnessLabel}</strong>
    <div>発行元：{finding.sourceId} / Health：{status.health}</div>
    <div>最終成功：{status.lastSuccessfulCheckAt ?? "未確認"}</div>
    <div>証跡期限：{status.evidenceValidUntil ?? "未確認"}</div>
    <div data-testid={`finding-source-lineage-${finding.ruleId}`}>
      <strong>発生源照合：{lineage.relation === "ci-run-matched"
        ? "CI実行Runに一致（技術記録のみ）"
        : lineage.relation === "osv-observation-matched"
          ? "OSVソース観測に一致（技術記録のみ）"
          : "Finding固有の実行証跡は未確認（Gray）"}</strong>
      <div>Finding観測時刻：{lineage.findingObservedAt ?? "同一検査との照合未完了"}</div>
      <div>CI対象SHA：{lineage.ciTargetSha ?? "未確認／非該当"} ・実稼働SHA：未確認</div>
      <small>ソースの期限内判定とFindingの発生源照合は別軸です。SCS公式評価Evidence・Remediation完了はunknown。</small>
    </div>
    <small>当該ソースの技術観測のみ。SCS証跡・実稼働環境の安全性は未検証。</small>
  </div>;
};

/**
 * #420: explicit, read-only lookup in the EXISTING independently authorized,
 * scoped and integrity-checked durable Audit endpoint. A matching request ID
 * is not remediation proof or causation between this record and the Finding.
 */
const AuditRequestProofLookup = ({ requestId, finding }: {
  readonly requestId: string; readonly finding: SecurityFinding;
}) => {
  const abortRef = useRef<AbortController | null>(null);
  const [result, setResult] = useState<
    { readonly kind: "idle" | "loading" | "unavailable" }
    | { readonly kind: "ready"; readonly evidence: AuditRequestLookupEvidence }
  >({ kind: "idle" });
  useEffect(() => () => { abortRef.current?.abort(); }, []);
  const lookup = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setResult({ kind: "loading" });
    const params = new URLSearchParams({ scopeId: SCOPE, requestId, limit: "1" });
    try {
      const response = await fetch(`/api/admin/audit?${params.toString()}`, {
        headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) { setResult({ kind: "unavailable" }); return; }
      const raw: unknown = await response.json();
      if (controller.signal.aborted) return;
      setResult({ kind: "ready",
        evidence: readVerifiedAuditRequestMatch(raw, requestId, SCOPE, new Date().toISOString()) });
    } catch {
      if (!controller.signal.aborted) setResult({ kind: "unavailable" });
    }
  };
  return <div data-testid="finding-audit-request-proof">
    <button type="button" disabled={result.kind === "loading"} onClick={() => { void lookup(); }}>
      保存済み監査レコードを照合
    </button>
    {result.kind === "idle" && <small>未照会（実在・同一原因・是正完了はいずれも未確認）</small>}
    {result.kind === "loading" && <small role="status">監査ログを実照合中…</small>}
    {result.kind === "unavailable" && <small role="alert">監査ログ照合不可（Gray・未確認）</small>}
    {result.kind === "ready" && (result.evidence.state === "request-id-found"
      ? <div role="status" data-testid="finding-audit-request-match">
        <strong>同一Request IDの保存済み監査記録あり（環境・Scope限定）</strong>
        <div>実記録: {result.evidence.record.environment} /
          <time dateTime={result.evidence.record.timestamp}>{result.evidence.record.timestamp}</time> /
          {result.evidence.record.category} / {result.evidence.record.action} /
          {result.evidence.record.outcome}</div>
        {correlateFindingAuditResource(finding, result.evidence, new Date().toISOString())
          === "same-resource-successful-mutation"
          ? <strong data-testid="finding-audit-resource-match">同一リソースへの変更監査記録あり（是正完了は未証明）</strong>
          : <small>Request ID一致のみ。Resource/変更実績との相関は未確認。</small>}
        <small>Findingとの因果関係・修正作業・Remediation完了・SCS適合は未確認。</small>
      </div>
      : result.evidence.state === "no-record"
        ? <small role="status">一致する保存済み監査記録なし（当該環境・Scopeのみ／是正完了未確認）</small>
        : <small role="alert">監査応答を検証できません（Gray・未確認）</small>)}
  </div>;
};

/** On-demand real Full CI step evidence, never official SCS assessment. */
type ScsFullCiTrace = {
  readonly schemaVersion: 1;
  readonly requirementId: string;
  readonly state: "observed" | "not-connected" | "unavailable";
  readonly runId: number | null;
  readonly targetSha: string | null;
  readonly checkedAt: string | null;
  readonly stepConclusion: "success" | "failure" | null;
  readonly scsEvidenceState: "unknown";
};
const isScsFullCiTrace = (value: unknown, requirementId: string): value is ScsFullCiTrace => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<ScsFullCiTrace>;
  if (Object.keys(v).sort().join(",") !==
    "checkedAt,requirementId,runId,schemaVersion,scsEvidenceState,state,stepConclusion,targetSha") return false;
  if (v.schemaVersion !== 1 || v.requirementId !== requirementId
    || v.scsEvidenceState !== "unknown") return false;
  if (v.state === "not-connected" || v.state === "unavailable") {
    return v.runId === null && v.targetSha === null
      && v.checkedAt === null && v.stepConclusion === null;
  }
  return v.state === "observed" && Number.isSafeInteger(v.runId) && (v.runId ?? 0) > 0
    && typeof v.targetSha === "string" && /^[a-f0-9]{40}$/u.test(v.targetSha)
    && isTime(v.checkedAt) && v.checkedAt <= new Date().toISOString()
    && (v.stepConclusion === "success" || v.stepConclusion === "failure");
};
const ScsFullCiTraceLookup = ({ requirementId }: { readonly requirementId: string }) => {
  const [result, setResult] = useState<
    { readonly kind: "idle" | "loading" | "unavailable" }
    | { readonly kind: "ready"; readonly data: ScsFullCiTrace }
  >({ kind: "idle" });
  const lookup = async () => {
    setResult({ kind: "loading" });
    try {
      const response = await fetch(
        "/api/admin/security/center?scopeId=workhub-company&scsRequirementId=" + encodeURIComponent(requirementId),
        { method: "GET", headers: { accept: "application/json" }, cache: "no-store" },
      );
      if (!response.ok) { setResult({ kind: "unavailable" }); return; }
      const raw: unknown = await response.json();
      setResult(isScsFullCiTrace(raw, requirementId)
        ? { kind: "ready", data: raw } : { kind: "unavailable" });
    } catch { setResult({ kind: "unavailable" }); }
  };
  return <div data-testid={"scs-full-ci-trace-" + requirementId}>
    <button type="button" disabled={result.kind === "loading"} onClick={() => { void lookup(); }}>
      登録済みUnitの実CI証跡を照合
    </button>
    {result.kind === "idle" && <small>実行Runは未照合</small>}
    {result.kind === "loading" && <small role="status">固定Full CIの実行結果を照合中…</small>}
    {result.kind === "unavailable" && <small role="alert">CI証跡を検証できません（Gray）</small>}
    {result.kind === "ready" && (result.data.state === "observed"
      ? <div data-testid={"scs-full-ci-observed-" + requirementId}>
        <strong>Full local validation core: {result.data.stepConclusion}</strong>
        <div>技術実行証跡：<a href={"https://github.com/" + REPOSITORY + "/actions/runs/" + result.data.runId}
          target="_blank" rel="noopener noreferrer">Run #{result.data.runId}</a>
          {" / SHA "}{result.data.targetSha} / 更新 {result.data.checkedAt}</div>
        <small>登録済みUnitが含まれるCIのステップ結果です。要件別テスト成功・現在のmain/Production反映・SCS公式Evidence・Remediationは別途未検証。</small>
      </div> : <small role="status">現環境では証跡未接続／取得不能（Gray）</small>)}
  </div>;
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
  readonly controlFinding?: SecurityFinding;
};
/**
 * Reconstruct the *exact* permitted CI control failure, rather than trusting
 * a free-form GitHub response or promoting it to a scanner vulnerability.
 */
const matchesControlFailure = (input: unknown, source: Coverage): input is SecurityFinding => {
  const latest = source.ci.latest;
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !latest || latest.checkConclusion !== "failure") return false;
  const raw = input as Record<string, unknown>;
  const allowed = ["ruleId", "sourceId", "category", "severity", "status",
    "resourceRef", "detectedAt", "lastObservedAt", "assessedAt",
    "evidence", "remediationCode", "riskDisposition"].sort();
  if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(allowed)
    || !isTime(raw.assessedAt) || raw.assessedAt > new Date().toISOString()) return false;
  const category = source.sourceId === "dependency_audit" ? "dependency"
    : source.sourceId === "secret_detection" ? "data" : "configuration";
  const severity = source.sourceId === "dependency_audit" || source.sourceId === "secret_detection"
    ? "high" : "medium";
  try {
    const expected = normalizeSecurityFinding({
      ruleId: "ci_step_failure", category, severity, status: "open",
      resourceRef: "commit_" + latest.targetSha.slice(0, 12),
      detectedAt: latest.updatedAt, lastObservedAt: latest.updatedAt,
      evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "run_" + latest.runId }],
      remediationCode: "review_control",
    }, source.sourceId, raw.assessedAt);
    return Object.entries(expected).every(([key, value]) =>
      JSON.stringify(raw[key]) === JSON.stringify(value));
  } catch { return false; }
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
      : (v.state === "unavailable" || v.state === "not-run") && v.conclusion === null)
    && (v.controlFinding === undefined || (v.state === "observed"
      && v.conclusion === "failure" && matchesControlFailure(v.controlFinding, source)));
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
      {result.data.controlFinding && <span data-testid={`security-control-finding-${source.sourceId}`}>
        CI制御異常（実検査ステップの失敗、脆弱性診断結果ではありません）：
        {result.data.controlFinding.ruleId} / {result.data.controlFinding.severity} /
        {result.data.controlFinding.evidence[0]?.referenceId} /
        SHA {result.data.controlFinding.resourceRef?.slice(7)}
        （監査証跡リンク・原因特定・脆弱性件数は未検証）
      </span>}
    </small>}
  </div>;
};

const RunReference = ({ run }: { readonly run: CiRun }) => <>
  <a href={`https://github.com/${REPOSITORY}/actions/runs/${run.runId}`} target="_blank" rel="noopener noreferrer">Run #{run.runId}</a>
  <small title={run.targetSha}>SHA {run.targetSha.slice(0, 12)} / {run.event}</small>
  <small><time dateTime={run.updatedAt}>{run.updatedAt}</time>（更新日時）</small>
</>;


const ADVISORY_ID = /^(?:GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-[0-9]{4}-[0-9]{4,}|OSV-[0-9]{4}-[0-9]+)$/u;
type OsvAdvisory = { readonly packageRef: string; readonly advisoryId: string };
type OsvReport = { readonly schemaVersion: 1; readonly source: "OSV";
  readonly scope: "runtime-lock-only"; readonly state: "verified" | "unavailable";
  readonly checkedAt: string | null; readonly checkedPackages: number | null;
  readonly advisoryCount: number | null; readonly advisories: readonly OsvAdvisory[] | null };
const isOsvReport = (input: unknown): input is OsvReport => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !==
    ["schemaVersion", "source", "scope", "state", "checkedAt", "checkedPackages", "advisoryCount", "advisories"].sort().join(",")) return false;
  if (value.schemaVersion !== 1 || value.source !== "OSV" || value.scope !== "runtime-lock-only") return false;
  if (value.state === "unavailable") return value.checkedAt === null && value.checkedPackages === null
    && value.advisoryCount === null && value.advisories === null;
  if (value.state !== "verified" || !isTime(value.checkedAt)
    || value.checkedAt > new Date().toISOString()
    || value.checkedPackages !== runtimeInventory.packages.length
    || !Array.isArray(value.advisories) || value.advisories.length > 64
    || value.advisoryCount !== value.advisories.length) return false;
  const allowed = new Set(runtimeInventory.packages.map(p => p.ref));
  const seen = new Set<string>();
  for (const row of value.advisories) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const a = row as Record<string, unknown>;
    if (Object.keys(a).sort().join(",") !== "advisoryId,packageRef"
      || typeof a.packageRef !== "string" || !allowed.has(a.packageRef)
      || typeof a.advisoryId !== "string" || !ADVISORY_ID.test(a.advisoryId)) return false;
    const key = a.packageRef + ":" + a.advisoryId;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};
const OsvRuntimeAdvisories = () => {
  const [result, setResult] = useState<
    { readonly state: "idle" | "loading" | "unavailable" }
    | { readonly state: "verified"; readonly report: OsvReport }>({ state: "idle" });
  const load = async () => {
    setResult({ state: "loading" });
    try {
      const response = await fetch(
        "/api/admin/security/center?scopeId=workhub-company&dependencyAdvisories=runtime",
        { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) { setResult({ state: "unavailable" }); return; }
      const data: unknown = await response.json();
      setResult(isOsvReport(data) && data.state === "verified"
        ? { state: "verified", report: data } : { state: "unavailable" });
    } catch { setResult({ state: "unavailable" }); }
  };
  return <div data-testid="security-osv-runtime-panel">
    <h3>本番依存ライブラリの脆弱性アドバイザリ（OSV）</h3>
    <p>現在のpackage-lockに記録された本番用12エントリを個別に照会します。
      重大度・修復状態・本番稼働環境との一致・アプリ全体の安全性・SCS適合は判定しません。</p>
    <button type="button" disabled={result.state === "loading"}
      onClick={() => { void load(); }}>本番依存12件の脆弱性情報を照会</button>
    {result.state === "idle" && <p>未照会。アドバイザリの有無は不明です。</p>}
    {result.state === "loading" && <p role="status">OSVへ照会中…</p>}
    {result.state === "unavailable" && <p role="alert">OSV照会不可（Gray）。0件や安全とは判定しません。</p>}
    {result.state === "verified" && <div data-testid="security-osv-verified">
      <p role="status">OSV照会時刻 {result.report.checkedAt}・対象 {result.report.checkedPackages} エントリ・
        アドバイザリ {result.report.advisoryCount} 件（照会範囲のみ）</p>
      {result.report.advisories?.length === 0
        ? <p>対象のロック済み12エントリについてアドバイザリIDの返却はありませんでした。
          他の脆弱性・未監視領域まで0件とは判定しません。</p>
        : <div className="admin-audit-table-wrap"><table className="admin-audit-table">
          <thead><tr><th>ロック済みパッケージ</th><th>OSVアドバイザリID</th><th>重大度／対応状況</th></tr></thead>
          <tbody>{result.report.advisories?.map(item => {
            const pkg = runtimeInventory.packages.find(row => row.ref === item.packageRef)!;
            return <tr key={item.packageRef + ":" + item.advisoryId}>
              <td>{pkg.name} / {pkg.version}</td>
              <td><a target="_blank" rel="noopener noreferrer"
                href={"https://osv.dev/vulnerability/" + encodeURIComponent(item.advisoryId)}>
                {item.advisoryId}</a></td>
              <td>未評価（原票参照）</td>
            </tr>;
          })}</tbody>
        </table></div>}
    </div>}
  </div>;
};

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
  const [osvFindingLookup, setOsvFindingLookup] = useState<"idle" | "loading" | "verified" | "unknown">("idle");
  const [osvAdvisories, setOsvAdvisories] = useState<readonly {packageRef:string;advisoryId:string}[]>([]);
  const [evidenceNow, setEvidenceNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    // Evidence can expire while an administrator leaves the panel open.
    // Reevaluate in memory only: no background remote scan or audit query.
    const timer = setInterval(() => setEvidenceNow(new Date().toISOString()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const [osvTraceSnapshot, setOsvTraceSnapshot] = useState<OsvSnapshot | null>(null);
  const [controlLookup, setControlLookup] = useState<"idle" | "loading" | "verified" | "unknown" | "unavailable">("idle");
  const load = async () => {
    setOsvTraceSnapshot(null);
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
  const loadObservedControls = async () => {
    // The CI control feed must never inherit an earlier OSV technical trace.
    setOsvTraceSnapshot(null);
    setControlLookup("loading");
    try {
      const response = await fetch("/api/admin/security/center?scopeId=workhub-company&controlFindings=latest", {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        setState({ kind: "denied" }); setControlLookup("unavailable"); return;
      }
      if (!response.ok) {
        setState({ kind: "unavailable" }); setControlLookup("unavailable"); return;
      }
      const payload: unknown = await response.json();
      if (!isObservedControlSnapshot(payload)) {
        setState({ kind: "unavailable" }); setControlLookup("unavailable"); return;
      }
      // Replace the previous observation even when the new result has no verified Finding.
      // Otherwise an old, once-verified CI failure could be mistaken for the latest result.
      setState({ kind: "ready", data: payload });
      setControlLookup(payload.findings.state === "verified" ? "verified" : "unknown");
    } catch { setState({ kind: "unavailable" }); setControlLookup("unavailable"); }
  };

  const loadOsvFindings = async () => {
    setOsvFindingLookup("loading");
    setOsvAdvisories([]);
    setOsvTraceSnapshot(null);
    try {
      const response = await fetch("/api/admin/security/center?scopeId=workhub-company&dependencyFindings=runtime", {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        setState({ kind: "denied" }); setOsvFindingLookup("unknown"); return;
      }
      if (!response.ok) { setState({ kind: "unavailable" }); setOsvFindingLookup("unknown"); return; }
      const payload: unknown = await response.json();
      if (!isSnapshot(payload) || !isOsvFindingSnapshot(payload)) {
        setState({ kind: "unavailable" }); setOsvFindingLookup("unknown"); return;
      }
      setState({ kind: "ready", data: payload });
      if (payload.dependencyScope.state === "verified") {
        setOsvAdvisories(payload.dependencyScope.advisories);
        // Store only a checked, bounded and trusted OSV projection for trace links.
        setOsvTraceSnapshot(payload);
        setOsvFindingLookup("verified");
      } else setOsvFindingLookup("unknown");
    } catch { setState({ kind: "unavailable" }); setOsvFindingLookup("unknown"); }
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
  // Use render-time now, not the earlier mount-time clock, for newly fetched OSV observations.
  const scsObservationNow = new Date().toISOString();
  const evidencePaths = ready?.scs.requirements.map(r => {
    const technical = osvTraceSnapshot ? scsOsvTechnicalEvidenceTrace(
      r, osvTraceSnapshot.sources.find(source => source.sourceId === "dependency_audit"),
      osvTraceSnapshot.dependencyScope, osvTraceSnapshot.observedAt, scsObservationNow) : null;
    return scsRequirementEvidencePath(r, technical);
  }) ?? [];
  const observedPaths = evidencePaths.filter(path => path.state === "technical-observation").length;
  const registeredPaths = evidencePaths.filter(path => path.state === "registered-reference-only").length;
  const missingPaths = evidencePaths.filter(path => path.state === "no-valid-test-reference").length;
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
      <OsvRuntimeAdvisories />
      <h3>Security Finding（検査済みソース限定）</h3>
      <p>OSVの実アドバイザリIDを、レビュー済み本番依存12ロックエントリに限定して照合します。重大度infoは未評価の仮置き、状態openは照会時点の要対応表示で、修復済みかどうかの確認結果ではありません。</p>
      <button type="button" disabled={osvFindingLookup === "loading"} onClick={() => { void loadOsvFindings(); }}>OSV実アドバイザリFindingを照合</button>
      {osvFindingLookup === "loading" && <p role="status">OSVの限定照会中…</p>}
      {osvFindingLookup === "unknown" && <p role="alert" data-testid="osv-finding-unknown">OSV照会結果を確認できません（Gray／件数不明）。</p>}
      {osvFindingLookup === "verified" && <div data-testid="osv-finding-verified"><p>OSV照会範囲：本番依存12ロックエントリ。アドバイザリ {osvAdvisories.length} 件。全体の脆弱性0件やSCS適合は意味しません。</p>
        {osvAdvisories.map((a, i) => <p key={a.packageRef + a.advisoryId + i}>{a.packageRef}：{a.advisoryId}（OSV ID、個別Severity未検証）</p>)}
      </div>}
      <p>既存のGitHub CIに対して、最後のRunで失敗した既知の検査ステップのみを実際に照合し、
        CI制御異常Findingとして一覧に接続します。脆弱性そのものの検出、CI成功時のFinding 0件、
        現在の本番環境の安全性は保証しません。過去のSHAでの失敗もあり得ます。</p>
      <button type="button" disabled={controlLookup === "loading"}
        onClick={() => { void loadObservedControls(); }}>実CI制御異常Findingを照合</button>
      {controlLookup === "loading" && <p role="status" data-testid="security-control-lookup">実CI検査ステップを照合中…</p>}
      {controlLookup === "unknown" && <p role="status" data-testid="security-control-lookup">
        確認できたCI制御異常Findingはありません。未検査・成功Runを脆弱性0件とは扱いません。
      </p>}
      {controlLookup === "unavailable" && <p role="alert" data-testid="security-control-lookup">
        CI制御異常Findingの照合結果は利用できません（Gray／件数不明）。
      </p>}
      {controlLookup === "verified" && <p role="status" data-testid="security-control-lookup">
        実RunとStepの失敗を確認したCI制御異常のみ表示しています。ほかのFindingは未評価です。
      </p>}
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
          証跡とRemediationは許可済みコードのみ。外部URL・生ログ・承認操作はありません。
          技術Evidenceの鮮度は当該ソースの取得時刻・期限から自動更新します。SCS適合やAudit一致の証明ではありません。</p>
        <div className="admin-audit-table-wrap"><table className="admin-audit-table" data-testid="security-findings-table" id="security-findings-table">
          <thead><tr><th>Rule / Source</th><th>Severity / Category</th><th>Status / Risk exception</th>
            <th>Evidence（コード・参照IDのみ）</th><th>Evidence鮮度・Source health</th><th>Remediation・監査記録照合</th></tr></thead>
          <tbody>{visibleFindings.map(item => <tr key={`${item.sourceId}:${item.ruleId}:${item.resourceRef ?? ""}`}>
            <td>{item.ruleId}<small>{item.sourceId}</small></td>
            <td>{item.severity} / {item.category}</td>
            <td>{item.status} / {item.riskDisposition === "accepted-expired"
              ? "例外期限切れ（承認無効）" : item.riskDisposition === "accepted-current"
                ? "期限内の承認記録あり（再確認要）" : "例外なし"}</td>
            <td>{item.evidence.map((evidence, i) => <div key={i}>
              {evidence.kind} / {evidence.code} / {evidence.referenceId ?? "参照ID未登録"}
            </div>)}</td>
            <td><FindingEvidenceStatus finding={item} sources={ready.sources} now={evidenceNow} /></td>
            <td>{item.remediationCode ?? "対応コード未登録"}
              <div>{item.remediationCode ? "調査・修正の候補（実施・完了は未確認）" : "対応方針は未確認"}</div>
              {(() => {
                const route = getFindingTriageRoute(item, ready.sources, evidenceNow,
                  osvTraceSnapshot === ready && osvTraceSnapshot.dependencyScope.state === "verified"
                    ? osvTraceSnapshot.dependencyScope.advisories : []);
                return <div data-testid={`finding-remediation-route-${item.ruleId}`}>
                  <strong>調査の次の一手：{route.action}</strong>
                  <div>{route.href ? <a href={route.href} target="_blank" rel="noopener noreferrer">
                    調査対象を開く（読み取り専用）</a> : "原票リンク未確認（Gray／手動照合が必要）"}</div>
                  <small>Audit correlation：{route.auditCorrelation === "lookup-required"
                    ? "Request IDの実照合が必要" : "相関IDなし（未確認）"}。
                    原票への導線は是正の実施・完了や監査上の因果関係を証明しません。</small>
                </div>;
              })()}
              <div>{item.auditRequestId
                ? <a href={`/admin?auditRequestId=${encodeURIComponent(item.auditRequestId)}#admin-audit-and-security`}>
                  監査ログをリクエストIDで照合（{item.auditRequestId}）
                </a>
                : "監査相関ID未登録（ログとの関連は未確認）"}
                {item.auditRequestId && <>
                  <small>相関IDは照合用ヒント。実在する監査イベントとの一致は別途確認が必要。</small>
                  <AuditRequestProofLookup key={item.auditRequestId} requestId={item.auditRequestId} finding={item} />
                </>}</div>
            </td>
          </tr>)}</tbody>
        </table></div>
      </>}
      <h3>SCS要件別の責任・Control・証跡</h3>
      <p data-testid="scs-evidence-summary">Requirement → Evidence到達状況（全{evidencePaths.length}要件）：
        実観測に到達（技術のみ）{observedPaths}件 ／ 登録済みテスト参照のみ{registeredPaths}件 ／ 有効テスト参照未登録{missingPaths}件。
        SCS公式評価Evidence・実行SHA・継続的適合は全件未検証（Gray）。</p>
      <p>既存要件対応表の参照元確認日：{ready.scs.sourceVerifiedAt}。これは各要件の監査・証跡の最終確認日ではありません。検査実行やSCS認証取得を示しません。</p>
      <p>テストファイルのリンクは登録済みソースへの案内です。リンク先は閲覧時点のGitHub mainで、稼働アプリ・CI実行対象SHAとは限りません。テスト成功や証跡の存在・鮮度を確認したものではありません。</p>
      <label>要件・責任を検索 <input value={filter} onChange={(event) => setFilter(event.target.value)}
        placeholder="例：3-1-1、Project Responsibility" /></label>
      <div className="admin-audit-table-wrap"><table className="admin-audit-table">
        <thead><tr><th>Requirement</th><th>Responsibility</th><th>Control</th><th>Test source / Evidence（参照のみ・未検証）</th><th>Freshness</th><th>Finding / Remediation</th></tr></thead>
        <tbody>{requirements.map((r) => {
          const osvTrace = osvTraceSnapshot
            ? scsOsvTechnicalEvidenceTrace(
              r, osvTraceSnapshot.sources.find(source => source.sourceId === "dependency_audit"),
              osvTraceSnapshot.dependencyScope, osvTraceSnapshot.observedAt, scsObservationNow)
            : null;
          const path = scsRequirementEvidencePath(r, osvTrace);
          const candidateFreshness = assessScsEvidenceCandidateFreshness({
            responsibility: r.responsibility, sourceVerifiedAt: ready.scs.sourceVerifiedAt,
            evidence: null, policy: null,
          }, scsObservationNow);
          const reviewedStepSourceId = scsReviewedCiStepSource(r);
          const reviewedCiSource = reviewedStepSourceId
            ? ready.sources.find(source => source.sourceId === reviewedStepSourceId) : undefined;
          return <tr key={r.id} data-testid={`scs-requirement-${r.id}`}>
            <td><strong>{r.id}</strong><small>{r.name}</small></td><td>{r.responsibility}</td>
            <td>{r.control}</td><td><div data-testid={`scs-evidence-path-${r.id}`}>
              <strong>{path.state === "technical-observation" ? "実観測に到達（技術のみ）"
                : path.state === "registered-reference-only" ? "登録済みテスト参照のみ（実行未検証）"
                  : "有効テスト参照未登録（証跡未確認）"}</strong>
              <small>Requirement → Control → Test参照 → {path.state === "technical-observation"
                ? "限定技術観測" : "Evidence未接続"}。SCS公式評価・Evidence鮮度はunknown。</small>
            </div><ScsTestReferences reference={r.testReference} />
              <div>証跡名：{r.evidenceReference ?? "未登録"}（未検証）</div>
              {scsFullCiEvidenceEligible(r) && <ScsFullCiTraceLookup requirementId={r.id} />}
              {reviewedStepSourceId && reviewedCiSource && <div data-testid={`scs-ci-step-trace-${r.id}`}>
                <strong>登録Workflowの実CI検査Step照合（要件適合証明ではない）</strong>
                <div>固定Source: {reviewedStepSourceId}。実行Run・SHA・Step結果は明示照会が必要。</div>
                <CiStepEvidence source={reviewedCiSource} />
                <small>検査Stepの成功でもSCS評価／当該要件の全Control検証／Production反映／Remediation完了は未確認。</small>
              </div>}
              {osvTrace && <div data-testid={`scs-osv-trace-${r.id}`}>
                <strong>OSV実観測への技術トレース（SCS適合の証明ではありません）</strong>
                <div>Source: {osvTrace.sourceId} / runtime lock {osvTrace.checkedPackages}件のみ</div>
                <div>取得: <time dateTime={osvTrace.checkedAt}>{osvTrace.checkedAt}</time>
                  / 技術観測期限: <time dateTime={osvTrace.validUntil}>{osvTrace.validUntil}</time></div>
                <div>OSV ID {osvTrace.advisoryCount}件：
                  {osvTrace.advisories.length > 0
                    ? osvTrace.advisories.map(advisory => <span key={advisory.packageRef + ":" + advisory.advisoryId}>
                      {" "}{advisory.packageRef} /
                      <a target="_blank" rel="noopener noreferrer"
                        href={"https://osv.dev/vulnerability/" + encodeURIComponent(advisory.advisoryId)}>
                        {advisory.advisoryId}</a>
                    </span>)
                    : "確認済み12エントリでは0件（他ソースは未評価）"}</div>
              </div>}
            </td>
            <td>未検証（SCS証跡 {r.evidenceFreshness}）
              <div data-testid={"scs-candidate-freshness-" + r.id}>
                <strong>要件別正式Evidence: {candidateFreshness.state === "missing"
                  ? "未接続（missing）" : candidateFreshness.state === "not-applicable"
                    ? "対象外（明示的NA）" : candidateFreshness.state === "unavailable"
                      ? "取得不能（unavailable）" : candidateFreshness.state === "stale"
                        ? "再レビューが必要（stale）" : "技術鮮度候補のみ（current）"}</strong>
                <small>評価に必要：Controlレビュー日時、正式Evidence生成日時、
                  証跡種別別の承認済み期限、レビューSHA・対象SHA、Runtimeなら稼働SHA。
                  {r.responsibility}は独立した責任区分。SCS公式評価はunknown（Gray）。</small>
              </div>
              {osvTrace && <div data-testid={`scs-osv-freshness-${r.id}`}>
                OSV技術観測：{osvTrace.freshness === "current"
                  ? "取得時点の期限内（SCSは未検証）" : "期限切れ（Gray／再照会要）"}
              </div>}
            </td>
            <td>{osvTrace
              ? <div>対応するOSV Finding {osvTrace.advisoryCount}件：
                <a href="#security-findings-table">Finding一覧の詳細へ</a>
                <div>Remediation: update_dependency（検討案のみ・完了未確認）</div>
                <div>Audit correlation: 未確認（相関ID未登録）</div>
              </div>
              : "未接続 / 未接続"}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p>表示 {requirements.length} / {ready.scs.requirements.length} 要件。SeverityはFinding、SCS statusは要件別の責任・実装状態であり、別の評価軸です。</p>
      <p><a href="#admin-audit-and-security">操作監査ログを別画面で確認</a></p>
    </>}
  </section>;
}
