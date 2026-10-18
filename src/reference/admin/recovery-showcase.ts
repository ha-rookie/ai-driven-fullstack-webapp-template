/** #431: read-only interactive showcase of the EXISTING recovery evaluator.
 * All evidence is generated locally from fictitious relative timestamps.
 * It must never be sent to the API or treated as an actual provider observation.
 */
import { assessRecoveryReadiness, type RecoveryObservation } from "../../shared/recovery/readiness";
import { projectRecoveryPlan, RECOVERY_STEPS, type RecoveryOperationSnapshot } from "../../shared/recovery/recovery-plan";
import { projectRecoveryReviewAction } from "../../shared/recovery/review-action";

export const RECOVERY_SHOWCASE_SCENARIOS = [
  { id: "ready", label: "復旧検証OK", description: "架空のProduction復旧を想定し、模擬Human Gate・10件の検証済み手順が揃ってもサービス再開は人間の別判断とする" },
  { id: "rpo_breach", label: "RPO超過", description: "最後の復旧ポイントが目標より古く、運用者の確認が必要な場合" },
  { id: "restore_failed", label: "復元テスト失敗", description: "バックアップは成功していても復元後の整合性検証に失敗した場合、対応要確認となりサービスを再開しない" },
  { id: "restore_stale", label: "テスト期限切れ", description: "復元テスト自体は成功したが、最終検証が古い場合" },
  { id: "restore_missing", label: "復元記録なし", description: "バックアップの記録だけがあり、復元テストが実施されていない場合" },
  { id: "not_connected", label: "実証跡未接続", description: "取得元が未接続で、復旧可否を判断できない場合" },
] as const;

export type RecoveryShowcaseScenarioId = typeof RECOVERY_SHOWCASE_SCENARIOS[number]["id"];
/** #430 Golden Recovery failure injection; local-only, never modifies an incident or Audit. */
export const RECOVERY_SHOWCASE_FAILURES = [
  { id: "none", label: "証跡正常", description: "記録が検証可能な状態" },
  { id: "audit_missing", label: "監査証跡欠落", description: "途中ステップのAudit Event IDが欠落" },
  { id: "approval_missing", label: "承認証跡欠落", description: "RestoreのHuman Gate承認IDが欠落" },
  { id: "audit_stale", label: "監査観測期限切れ", description: "最後の監査観測が5分を超えて古い" },
  { id: "verification_unknown", label: "業務検証不明", description: "復元後の業務整合性がUNKNOWN" },
] as const;
export type RecoveryShowcaseFailureId = typeof RECOVERY_SHOWCASE_FAILURES[number]["id"];

export interface RecoveryShowcaseTargets {
  readonly rpoMinutes: number;
  readonly rtoMinutes: number;
  readonly restoreMaxAgeHours: number;
}
export const RECOVERY_SHOWCASE_DEFAULT_TARGETS: RecoveryShowcaseTargets = Object.freeze({
  rpoMinutes: 60, rtoMinutes: 45, restoreMaxAgeHours: 24,
});
export const projectRecoveryShowcase = (
  scenario: RecoveryShowcaseScenarioId, asOf: string,
  targets: RecoveryShowcaseTargets = RECOVERY_SHOWCASE_DEFAULT_TARGETS,
  failure: RecoveryShowcaseFailureId = "none",
) => {
  const ago = (minutes: number) => new Date(Date.parse(asOf) - minutes * 60_000).toISOString();
  const passed = {
    application: "PASSED", dataIntegrity: "PASSED", businessConsistency: "PASSED",
    integrations: "PASSED", jobs: "PASSED", security: "PASSED", audit: "PASSED",
  } as const;
  const point = ago(30);
  let evidence: RecoveryObservation = {
    sourceState: "available", observationComplete: true, observedAt: asOf,
    backup: { lastSuccessfulAt: ago(45), lastVerifiedAt: ago(40) },
    recoveryPoint: { at: point, verified: true },
    targets,
    restore: {
      completedAt: ago(5), testedRecoveryPointAt: point, result: "PASSED",
      durationMinutes: 20, checks: passed,
    },
  };

  if (scenario === "rpo_breach") {
    const oldPoint = ago(120);
    evidence = {
      ...evidence, recoveryPoint: { at: oldPoint, verified: true },
      restore: { ...evidence.restore!, testedRecoveryPointAt: oldPoint },
    };
  } else if (scenario === "restore_failed") {
    evidence = {
      ...evidence, restore: {
        ...evidence.restore!, result: "FAILED",
        checks: { ...passed, dataIntegrity: "FAILED" },
      },
    };
  } else if (scenario === "restore_stale") {
    const oldPoint = ago(2880);
    evidence = {
      ...evidence,
      backup: { lastSuccessfulAt: ago(2900), lastVerifiedAt: ago(2890) },
      recoveryPoint: { at: oldPoint, verified: true },
      targets,
      restore: { ...evidence.restore!, completedAt: ago(2800), testedRecoveryPointAt: oldPoint },
    };
  } else if (scenario === "restore_missing") {
    evidence = { ...evidence, restore: null };
  }

  const recovery = assessRecoveryReadiness(scenario === "not_connected" ? null : evidence, asOf);
  // Synthetic, audit-shaped checkpoints for display only. No API write or
  // persistent incident state: an interrupted run is reconstructed from the
  // same immutable evidence, never treated as a real resume authorization.
  const count = scenario === "not_connected" ? 0
    : scenario === "restore_missing" ? 4
      : scenario === "restore_failed" ? 7 : 10;
  const audit: RecoveryOperationSnapshot = {
    source: "verified-audit", scopeId: "workhub-company", environment: "preview",
    incidentId: "demo-incident", runId: "demo-recovery-run",
    observedAt: asOf,
    steps: RECOVERY_STEPS.slice(0, count).map((step, i) => ({
      id: step.id as Exclude<typeof step.id, "resume_service">,
      result: scenario === "restore_failed" && i === 6 ? "FAILED" as const : "PASSED" as const,
      recordedAt: ago(20 - i),
      auditEventId: "demo-audit-" + (i + 1),
      ...(step.id === "restore" ? { humanApprovalId: "DEMO-approval-only" } : {}),
    })),
    postRestoreChecks: count < 5 ? null : {
      application: "PASSED", dataIntegrity: scenario === "restore_failed" ? "FAILED" : "PASSED",
      businessConsistency: "PASSED", integrations: "PASSED",
      jobs: "PASSED", security: "PASSED", audit: "PASSED",
    },
  };
  // Inject one failure into the synthetic Audit-shaped input and let the
  // existing fail-closed validator decide. Never bypass its policy.
  const injected: RecoveryOperationSnapshot = {
    ...audit,
    observedAt: failure === "audit_stale" ? ago(6) : audit.observedAt,
    steps: audit.steps.map((step, index) => ({
      ...step,
      ...(failure === "audit_missing" && index === 2 ? { auditEventId: "" } : {}),
      ...(failure === "approval_missing" && step.id === "restore"
        ? { humanApprovalId: "" } : {}),
    })),
    postRestoreChecks: failure === "verification_unknown" && audit.postRestoreChecks
      ? { ...audit.postRestoreChecks, businessConsistency: "UNKNOWN" }
      : audit.postRestoreChecks,
  };
  const recoveryPlan = projectRecoveryPlan(recovery, "preview", asOf,
    scenario === "not_connected" ? null : injected);
  const review = projectRecoveryReviewAction(recovery, recoveryPlan, asOf);
  return {
    recovery,
    recoveryPlan,
    finding: review.finding,
    reviewAction: review.actionRequired,
    actionRequired: review.actionRequired !== null,
    restoreExecutionAllowed: false as const,
    resumeExecutionAllowed: false as const,
  };
};
