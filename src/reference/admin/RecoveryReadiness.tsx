import { useEffect, useState } from "react";
import type { RecoveryReadinessProjection } from "../../shared/recovery/readiness";
import { RECOVERY_STEPS, type RecoveryPlanProjection } from "../../shared/recovery/recovery-plan";
import { projectRecoveryShowcase, RECOVERY_SHOWCASE_SCENARIOS, RECOVERY_SHOWCASE_FAILURES, RECOVERY_SHOWCASE_DEFAULT_TARGETS, type RecoveryShowcaseScenarioId, type RecoveryShowcaseFailureId } from "./recovery-showcase";

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
const RESTORE_CHECKS = [
  { key: "application", label: "Application Health" },
  { key: "dataIntegrity", label: "DB Integrity" },
  { key: "businessConsistency", label: "Business Consistency" },
  { key: "integrations", label: "Integration Reconciliation" },
  { key: "jobs", label: "Job State" },
  { key: "security", label: "Security Check" },
  { key: "audit", label: "Audit Evidence" },
] as const;
const checkStatus = (value: unknown): boolean =>
  oneOf(value, ["PASSED", "FAILED", "UNKNOWN"]);
const validRestoreTest = (value: unknown): boolean => value === null || (
  record(value) && checkStatus(value.result)
  && typeof value.completedAt === "string"
  && typeof value.testedRecoveryPointAt === "string"
  && (value.durationMinutes === null ||
    (typeof value.durationMinutes === "number"
      && Number.isSafeInteger(value.durationMinutes) && value.durationMinutes >= 0))
  && record(value.checks)
  && RESTORE_CHECKS.every(check => checkStatus((value.checks as Record<string, unknown>)[check.key]))
);
const RESTORE_ACTION_LABELS: Readonly<Record<string, string>> = {
  rpo_breach_requires_human_review: "RPO目標を超過しています",
  rto_breach_requires_human_review: "復元時間がRTO目標を超過しています",
  restore_verification_failed_requires_human_review: "復元後の検証に失敗しています",
  restore_test_stale_requires_human_review: "復元テストの有効期間を超えています",
};
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
    && validRestoreTest(r.restoreTest)
    && Array.isArray(r.missingEvidence) && r.missingEvidence.every((s: unknown) => typeof s === "string")
    && gate.risk === "HUMAN_GATE" && gate.policyDecision === "HUMAN_GATE"
    && gate.executionAllowed === false && gate.operationId === "recovery.restore";
};

const fmt = (s: string | null): string => s ?? "未確認";
const metric = (n: number | null): string => n === null ? "未確認" : n + "分";
const RECOVERY_MISSING_EVIDENCE_LABELS: Readonly<Record<string, string>> = {
  source_not_verified: "復旧証跡の取得元が確認できません",
  backup_verification_missing: "バックアップの検証記録がありません",
  verified_recovery_point_missing: "検証済みの復旧ポイントがありません",
  rpo_rto_targets_missing: "RPO・RTOの目標が確認できません",
  restore_verification_missing: "復元テストの記録がありません",
  tested_recovery_point_unmatched: "復元テストと復旧ポイントが一致しません",
  restore_test_stale: "復元テストの結果が期限切れです",
  post_restore_verification_incomplete: "復元後の検証が完了していません",
};
/** Keep unrecognized provider diagnostics out of the operator-facing showcase. */
export const describeMissingRecoveryEvidence = (codes: readonly string[]): string =>
  codes.length === 0 ? "登録上の欠測なし（実際の復旧保証ではありません）"
    : codes.map(code => RECOVERY_MISSING_EVIDENCE_LABELS[code]
      ?? "未確認の復旧証跡があります").join(" / ");

/** Same seven evidence checks in live and fictitious showcase views. */
const RestoreCheckDetails = ({ recovery, demo }: {
  readonly recovery: RecoveryReadinessProjection; readonly demo: boolean;
}) => <div className="admin-audit-state"
  data-testid={demo ? "recovery-showcase-post-restore" : "recovery-post-restore-verification"}>
  <h3>復元後の7項目検証{demo ? "（架空データ）" : ""}</h3>
  <p>復元テスト: {recovery.restoreTest?.result ?? "UNKNOWN"} ／
    実施日時: {fmt(recovery.restoreTest?.completedAt ?? null)} ／
    検証した復旧ポイント: {fmt(recovery.restoreTest?.testedRecoveryPointAt ?? null)}</p>
  <ul>{RESTORE_CHECKS.map(check => <li key={check.key}>
    {check.label}：<strong data-testid={demo ? "demo-check-" + check.key : "check-" + check.key}>
      {recovery.restoreTest?.checks[check.key] ?? "UNKNOWN"}</strong>
  </li>)}</ul>
  <p>{recovery.restoreTest === null
    ? "復元テストの検証記録は取得できていません。"
    : recovery.postRestoreVerification === "PASSED"
      ? "7項目が合格。ただし復元テストの鮮度とRPO/RTOは別途確認が必要です。"
      : "未合格または未確認の項目があるため、復旧完了とは判定できません。"}</p>
</div>;

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
  const [showcaseScenario, setShowcaseScenario] = useState<RecoveryShowcaseScenarioId>("ready");
  const [showcaseFailure, setShowcaseFailure] = useState<RecoveryShowcaseFailureId>("none");
  const [demoTargets, setDemoTargets] = useState(RECOVERY_SHOWCASE_DEFAULT_TARGETS);
  const showcase = projectRecoveryShowcase(showcaseScenario, new Date().toISOString(), demoTargets, showcaseFailure);
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
      <RestoreCheckDetails recovery={recovery} demo={false} />
      <p className="admin-audit-note">復旧ポイント: {fmt(recovery.recoveryPoint?.at ?? null)}
        （検証: {recovery.recoveryPoint?.verified === true ? "確認済み" : "未確認"}）。
        未確認・不足項目: {describeMissingRecoveryEvidence(recovery.missingEvidence)}。</p>
      {view.actionRequired && <div className="admin-audit-state is-error" role="alert">
        復旧状態：対応要確認（{RESTORE_ACTION_LABELS[view.actionRequired.reason]
          ?? "追加確認が必要です"}）。復旧は自動実行しません。
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
    {/* The demo must remain usable even if the real admin API is offline or denies access. */}
      <div className="admin-audit-state" data-testid="recovery-showcase" aria-label="復旧判定シミュレーション">
        <h3>復旧判断を体験する（架空データのデモ）</h3>
        <p>シナリオを切り替えると実装済みのRPO/RTO・復元検証・Readiness判定が変わります。
          上の実環境の証跡とは完全に別で、DB・バックアップ・サービス状態は変更しません。</p>
        <div role="group" aria-label="デモシナリオ" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
          {RECOVERY_SHOWCASE_SCENARIOS.map(item => <button
            key={item.id} type="button" className="admin-inline-action"
            aria-pressed={showcaseScenario === item.id}
            onClick={() => setShowcaseScenario(item.id)}>{item.label}</button>)}
        </div>
        <p>{RECOVERY_SHOWCASE_SCENARIOS.find(item => item.id === showcaseScenario)?.description}</p>
        <fieldset style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "12px 0" }}>
          <legend>復旧目標を変更して判定を比較（架空データのみ）</legend>
          {([
            { key: "rpoMinutes", label: "RPO目標（分）", values: [15, 60, 180] },
            { key: "rtoMinutes", label: "RTO目標（分）", values: [10, 45, 90] },
            { key: "restoreMaxAgeHours", label: "復元テスト有効期限（時間）", values: [1, 24, 72] },
          ] as const).map(({ key, label, values }) => <label key={key}>
            {label}{" "}
            <select data-testid={"recovery-showcase-target-" + key}
              value={demoTargets[key]}
              onChange={event => setDemoTargets(prev => ({
                ...prev, [key]: Number(event.target.value),
              }))}>
              {values.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>)}
          <button type="button" className="admin-inline-action"
            onClick={() => setDemoTargets(RECOVERY_SHOWCASE_DEFAULT_TARGETS)}>目標を初期化</button>
        </fieldset>

        <fieldset style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "12px 0" }}>
          <legend>復旧途中の異常を注入して安全停止を確認（架空監査証跡）</legend>
          <label>異常パターン{" "}
            <select data-testid="recovery-showcase-failure" value={showcaseFailure}
              onChange={event => setShowcaseFailure(event.target.value as RecoveryShowcaseFailureId)}>
              {RECOVERY_SHOWCASE_FAILURES.map(item =>
                <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" className="admin-inline-action"
            onClick={() => setShowcaseFailure("none")}>異常を解除</button>
          <small>{RECOVERY_SHOWCASE_FAILURES.find(item => item.id === showcaseFailure)?.description}</small>
        </fieldset>
        <div className="admin-states" aria-label="デモ判定結果">
          <article className="admin-state-card">
            <strong>Recovery Readiness（デモ）</strong>
            <div data-testid="recovery-showcase-readiness">{showcase.recovery.readiness}</div>
          </article>
          <article className="admin-state-card">
            <strong>RPO（デモ）</strong>
            <div data-testid="recovery-showcase-rpo">{showcase.recovery.rpo.status}</div>
            <small>復旧ポイント経過: {metric(showcase.recovery.rpo.exposureMinutes)} ／ 目標: {metric(showcase.recovery.rpo.targetMinutes)}</small>
          </article>
          <article className="admin-state-card">
            <strong>RTO（デモ）</strong>
            <div data-testid="recovery-showcase-rto">{showcase.recovery.rto.status}</div>
            <small>復元所要: {metric(showcase.recovery.rto.measuredMinutes)} ／ 目標: {metric(showcase.recovery.rto.targetMinutes)}</small>
          </article>
          <article className="admin-state-card">
            <strong>Restore Verification（デモ）</strong>
            <div data-testid="recovery-showcase-freshness">{showcase.recovery.restoreFreshness}</div>
            <small>復元後検証: {showcase.recovery.postRestoreVerification}</small>
          </article>
        </div>
        {showcase.actionRequired && <p role="status" data-testid="recovery-showcase-action-required">
          RPO超過のためActionRequired：運用者による確認が必要です（デモ）。</p>}
        <RestoreCheckDetails recovery={showcase.recovery} demo />
        <div className="admin-audit-state" data-testid="recovery-showcase-plan">
          <h4>復旧手順・監査済みステップ（デモ専用）</h4>
          <p>事故ID: demo-incident ／ 実行ID: demo-recovery-run（架空）。
            記録された手順だけを検証済みとして表示し、途中中断・失敗時は再開を許可しません。</p>
          <ol>{showcase.recoveryPlan.steps.map(step => <li key={step.id}>
            <strong>{step.label}</strong>：{step.state}
            {step.requiresHumanGate ? "（Human Gate）" : ""}
          </li>)}</ol>
          <p data-testid="recovery-showcase-audit-source">監査証跡の検証:
            <strong> {showcase.recoveryPlan.evidenceSource}</strong>。
            証跡欠落・古い観測・承認ID欠落は、正常な復旧履歴とみなしません。</p>
          <p data-testid="recovery-showcase-resume">Service Resume 判定:
            <strong> {showcase.recoveryPlan.resumeDecision}</strong>（実行不可）。
            復元後チェック: {showcase.recoveryPlan.postRestore}。
            {showcase.recoveryPlan.blockers.length > 0
              ? " 未解決: " + showcase.recoveryPlan.blockers.join(" / ")
              : " 証跡上は人間による最終確認待ちです。自動再開しません。"}</p>
        </div>
        <p>不足証跡: {describeMissingRecoveryEvidence(showcase.recovery.missingEvidence)}</p>
        <p>Production Restore: HUMAN_GATE ／ 自動復旧: 不可 ／ Service Resume: 不可。
          デモは操作権限や実際の復旧成功を意味しません。</p>
      </div>
  </section>;
}
