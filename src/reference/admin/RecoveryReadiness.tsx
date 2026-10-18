import { useEffect, useState } from "react";
import type { RecoveryReadinessProjection } from "../../shared/recovery/readiness";
import { RECOVERY_STEPS, type RecoveryPlanProjection } from "../../shared/recovery/recovery-plan";

/** #431 Stage9: Recovery is evidence-driven, never inferred from backup creation. */
const SCOPE = "workhub-company";
interface ResponseView {
  readonly schemaVersion: 1;
  readonly scopeId: typeof SCOPE;
  readonly environment: "local" | "test" | "preview" | "production";
  readonly observedAt: string;
  readonly recovery: RecoveryReadinessProjection;
  readonly recoveryPlan: RecoveryPlanProjection;
  readonly auditEvidence: {
    readonly source: "durable-d1-audit";
    readonly status: "RECORDED" | "NONE" | "UNAVAILABLE";
    readonly recordsChecked: number | null;
    readonly latestAuditAt: string | null;
    readonly hasMore: boolean | null;
    readonly provesRecoverability: false;
  };
  readonly finding: { readonly id: string; readonly summary: string } | null;
  readonly actionRequired: { readonly findingId: string; readonly reason: string } | null;
  readonly restoreGate: {
    readonly risk: "HUMAN_GATE";
    readonly policyDecision: "HUMAN_GATE";
    readonly executionAllowed: false;
    readonly operationId: "recovery.restore";
    readonly policyVersion: string;
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const oneOf = (v: unknown, options: readonly string[]): v is string =>
  typeof v === "string" && options.includes(v);
const isRecoveryResponse = (value: unknown): value is ResponseView => {
  if (!record(value) || value.schemaVersion !== 1 || value.scopeId !== SCOPE
    || !oneOf(value.environment, ["local", "test", "preview", "production"])
    || typeof value.observedAt !== "string"
    || !record(value.recovery) || !record(value.restoreGate)
    || !record(value.recoveryPlan) || !record(value.auditEvidence)) return false;
  const r = value.recovery, gate = value.restoreGate, plan = value.recoveryPlan;
  const audit = value.auditEvidence;
  const auditSafe = audit.source === "durable-d1-audit"
    && oneOf(audit.status, ["RECORDED", "NONE", "UNAVAILABLE"])
    && audit.provesRecoverability === false
    && (audit.status === "UNAVAILABLE"
      ? audit.recordsChecked === null && audit.latestAuditAt === null && audit.hasMore === null
      : typeof audit.recordsChecked === "number"
        && Number.isSafeInteger(audit.recordsChecked)
        && audit.recordsChecked >= 0 && audit.recordsChecked <= 20
        && (audit.latestAuditAt === null || typeof audit.latestAuditAt === "string")
        && typeof audit.hasMore === "boolean");
  const planSafe = oneOf(plan.evidenceSource, ["not-connected", "unavailable", "verified-audit"])
    && oneOf(plan.resumeDecision, ["BLOCKED", "HUMAN_REVIEW_REQUIRED"])
    && plan.resumeExecutionAllowed === false
    && oneOf(plan.postRestore, ["PASSED", "FAILED", "UNKNOWN"])
    && Array.isArray(plan.steps) && plan.steps.length === RECOVERY_STEPS.length
    && plan.steps.every((item: unknown, index: number) => record(item)
      && item.id === RECOVERY_STEPS[index]?.id
      && item.executionAllowed === false
      && oneOf(item.state, ["VERIFIED", "FAILED", "PENDING", "UNKNOWN"]))
    && Array.isArray(plan.blockers) && plan.blockers.every((x: unknown) => typeof x === "string");
  return auditSafe && planSafe && oneOf(r.sourceState, ["available", "not-connected", "unavailable"])
    && oneOf(r.protection, ["PROTECTED", "DEGRADED", "UNPROTECTED", "UNKNOWN"])
    && oneOf(r.readiness, ["READY", "NOT_READY", "UNKNOWN"])
    && record(r.rpo) && record(r.rto)
    && oneOf(r.rpo.status, ["WITHIN_TARGET", "BREACHED", "UNKNOWN"])
    && oneOf(r.rto.status, ["WITHIN_TARGET", "BREACHED", "UNKNOWN"])
    && oneOf(r.restoreFreshness, ["CURRENT", "STALE", "MISSING", "FAILED", "UNKNOWN"])
    && Array.isArray(r.missingEvidence) && r.missingEvidence.every((s: unknown) => typeof s === "string")
    && gate.risk === "HUMAN_GATE" && gate.policyDecision === "HUMAN_GATE"
    && gate.executionAllowed === false && gate.operationId === "recovery.restore";
};

const fmt = (s: string | null): string => s ?? "未確認";
const metric = (n: number | null): string => n === null ? "未確認" : n + "分";

export default function RecoveryReadiness() {
  const [state, setState] = useState<
    { readonly kind: "loading" | "denied" | "unavailable" }
    | { readonly kind: "ready"; readonly data: ResponseView }
  >({ kind: "loading" });
  const load = async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/admin/operations/recovery-readiness?scopeId=" + SCOPE, {
        method: "GET", headers: { accept: "application/json" }, cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        setState({ kind: "denied" }); return;
      }
      if (!response.ok) { setState({ kind: "unavailable" }); return; }
      const raw: unknown = await response.json();
      setState(isRecoveryResponse(raw)
        ? { kind: "ready", data: raw } : { kind: "unavailable" });
    } catch { setState({ kind: "unavailable" }); }
  };
  useEffect(() => { void load(); }, []);
  const view = state.kind === "ready" ? state.data : null;
  const recovery = view?.recovery;

  return <section id="admin-recovery-readiness" className="admin-audit-panel"
    aria-labelledby="admin-recovery-readiness-title" data-testid="admin-recovery-readiness">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">SYSTEM / RECOVERABILITY</p>
        <h2 id="admin-recovery-readiness-title">バックアップ・復旧準備状況</h2>
        <p>バックアップ作成と復旧可能性は別です。実際の復元テストとシステム検証なしにREADYと表示しません。</p>
      </div>
      <button type="button" className="admin-inline-action" onClick={() => { void load(); }}
        disabled={state.kind === "loading"}>状態を再取得</button>
    </div>
    {state.kind === "loading" && <div className="admin-audit-state" role="status">復旧証跡を照合中…</div>}
    {state.kind === "denied" && <div className="admin-audit-state is-error" role="alert">
      管理権限がないため復旧情報を表示できません。</div>}
    {state.kind === "unavailable" && <div className="admin-audit-state is-error" role="alert">
      APIまたは証跡を取得できません。復旧状況は不明（UNKNOWN）です。</div>}
    {view && recovery && <>
      <p className="admin-audit-note">環境: {view.environment} ／ 観測: {view.observedAt} ／
        ソース: {recovery.sourceState}。{recovery.sourceState === "not-connected"
          ? "実バックアップ／復旧Providerは未接続です。"
          : recovery.sourceState === "unavailable" ? "証跡取得／内容検証に失敗しています。"
            : "登録済み技術証跡の照合結果であり、Provider保証とは異なります。"}</p>
      <div className="admin-states" aria-label="復旧の判定軸">
        <article className="admin-state-card"><strong>Backup Protection</strong>
          <div data-testid="recovery-protection">{recovery.protection}</div>
          <small>最終取得: {fmt(recovery.lastSuccessfulBackupAt)}</small>
          <small> / 最終検証: {fmt(recovery.lastVerifiedBackupAt)}</small>
        </article>
        <article className="admin-state-card"><strong>Recovery Point / RPO</strong>
          <div data-testid="recovery-rpo">{recovery.rpo.status}</div>
          <small>推定露出: {metric(recovery.rpo.exposureMinutes)} /
            目標: {metric(recovery.rpo.targetMinutes)}</small>
        </article>
        <article className="admin-state-card"><strong>Restore Verification / RTO</strong>
          <div data-testid="recovery-restore">{recovery.restoreFreshness} /
            {recovery.rto.status}</div>
          <small>最後の復旧検証: {fmt(recovery.lastRestoreVerifiedAt)}</small>
          <small> / 測定時間: {metric(recovery.rto.measuredMinutes)}</small>
          <small> / RTO目標: {metric(recovery.rto.targetMinutes)}</small>
        </article>
        <article className="admin-state-card"><strong>Recovery Readiness</strong>
          <div data-testid="recovery-readiness">{recovery.readiness}</div>
          <small>Post-Restore Verification: {recovery.postRestoreVerification}</small>
        </article>
      </div>
      <p className="admin-audit-note">復旧ポイント: {fmt(recovery.recoveryPoint?.at ?? null)}
        （検証: {recovery.recoveryPoint?.verified === true ? "確認済み" : "未確認"}）。
        欠測: {recovery.missingEvidence.join(" / ") || "登録上の欠測なし（公式保証ではありません）"}。</p>
      {view.actionRequired && <div className="admin-audit-state is-error" role="alert">
        RPO違反：対応要確認（{view.actionRequired.reason}）。復旧は自動実行しません。
      </div>}
      <div className="admin-audit-state" data-testid="recovery-audit-coverage">
        <h3>監査証跡（既存D1監査ログ・読み取り専用）</h3>
        <p>取得状態: <strong>{view.auditEvidence.status}</strong> ／
          照合レコード数: {view.auditEvidence.recordsChecked ?? "未確認"}
          {view.auditEvidence.hasMore === true ? "（次ページあり）" : ""} ／
          最新記録: {fmt(view.auditEvidence.latestAuditAt)}</p>
        <p>対象環境・業務スコープの監査レコードを既存D1から照合します。
          記録があっても、バックアップ検証やシステム復旧の成功を示すものではありません。</p>
      </div>
      <div className="admin-audit-state" data-testid="recovery-plan" aria-label="復旧手順（読み取り専用）">
        <h3>復旧手順：11ステップ（実行不可）</h3>
        <p>復旧事故ごとの監査済み記録: {view.recoveryPlan.evidenceSource}。
          {view.recoveryPlan.evidenceSource === "not-connected"
            ? "途中状態の永続化・再取得は未接続です。画面表示だけで復旧を再開したと判断しません。"
            : "各ステップの監査証跡に基づく判定です。実行コマンドはありません。"}</p>
        <ol>{view.recoveryPlan.steps.map((step) => <li key={step.id}>
          <strong>{step.label}</strong>：{step.state}
          {step.requiresHumanGate ? "（Human Gate）" : ""}
        </li>)}</ol>
        <p data-testid="recovery-resume-gate">Service Resume: <strong>{view.recoveryPlan.resumeDecision}</strong>
          （操作可能: いいえ）。事故ごとのPost-Restore検証: {view.recoveryPlan.postRestore}。
          未解決: {view.recoveryPlan.blockers.join(" / ") || "要Human Review・実再開は別工程"}。</p>
      </div>
      <div className="admin-audit-state" data-testid="recovery-human-gate">
        Production Restore: <strong>{view.restoreGate.policyDecision}</strong>
        （{view.restoreGate.policyVersion}）。Portalからの復元操作は不可、
        承認・監査・復元後の検証は別工程です。
      </div>
    </>}
  </section>;
}
