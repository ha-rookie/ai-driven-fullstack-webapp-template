/** #431: read-only interactive showcase of the EXISTING recovery evaluator.
 * All evidence is generated locally from fictitious relative timestamps.
 * It must never be sent to the API or treated as an actual provider observation.
 */
import { assessRecoveryReadiness, type RecoveryObservation } from "../../shared/recovery/readiness";
import { projectRecoveryPlan, RECOVERY_STEPS, type RecoveryOperationSnapshot } from "../../shared/recovery/recovery-plan";

export const RECOVERY_SHOWCASE_SCENARIOS = [
  { id: "ready", label: "復旧検証OK", description: "検証済みの復旧ポイント、復元テスト、業務検証が揃った場合" },
  { id: "rpo_breach", label: "RPO超過", description: "最後の復旧ポイントが目標より古く、運用者の確認が必要な場合" },
  { id: "restore_failed", label: "復元テスト失敗", description: "復元後のデータ整合性チェックが失敗した場合" },
  { id: "restore_stale", label: "テスト期限切れ", description: "復元テスト自体は成功したが、最終検証が古い場合" },
  { id: "restore_missing", label: "復元記録なし", description: "バックアップの記録だけがあり、復元テストが実施されていない場合" },
  { id: "not_connected", label: "実証跡未接続", description: "取得元が未接続で、復旧可否を判断できない場合" },
] as const;

export type RecoveryShowcaseScenarioId = typeof RECOVERY_SHOWCASE_SCENARIOS[number]["id"];

/** Controls only synthetic evidence, never live recovery observations. */
export interface RecoveryShowcaseTargets {
  readonly rpoMinutes: number;
  readonly rtoMinutes: number;
}

export const projectRecoveryShowcase = (
  scenario: RecoveryShowcaseScenarioId, asOf: string, targets?: RecoveryShowcaseTargets,
) => {
  if (targets && (!Number.isSafeInteger(targets.rpoMinutes) || targets.rpoMinutes < 1
    || targets.rpoMinutes > 43_200 || !Number.isSafeInteger(targets.rtoMinutes)
    || targets.rtoMinutes < 1 || targets.rtoMinutes > 10_080)) {
    throw new RangeError("Invalid demonstration RPO/RTO target");
  }
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
    targets: { rpoMinutes: 60, rtoMinutes: 45, restoreMaxAgeHours: 24 },
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
      targets: { rpoMinutes: 43200, rtoMinutes: 45, restoreMaxAgeHours: 24 },
      restore: { ...evidence.restore!, completedAt: ago(2800), testedRecoveryPointAt: oldPoint },
    };
  } else if (scenario === "restore_missing") {
    evidence = { ...evidence, restore: null };
  }

  if (targets && evidence.targets) {
    evidence = {
      ...evidence,
      targets: { ...evidence.targets, rpoMinutes: targets.rpoMinutes, rtoMinutes: targets.rtoMinutes },
    };
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
  const recoveryPlan = projectRecoveryPlan(recovery, "preview", asOf,
    scenario === "not_connected" ? null : audit);
  return {
    recovery,
    recoveryPlan,
    actionRequired: recovery.sourceState === "available" && recovery.rpo.status === "BREACHED",
    restoreExecutionAllowed: false as const,
    resumeExecutionAllowed: false as const,
  };
};
