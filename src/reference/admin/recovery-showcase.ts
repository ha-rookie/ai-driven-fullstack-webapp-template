/** #431: read-only interactive showcase of the EXISTING recovery evaluator.
 * All evidence is generated locally from fictitious relative timestamps.
 * It must never be sent to the API or treated as an actual provider observation.
 */
import { assessRecoveryReadiness, type RecoveryObservation } from "../../shared/recovery/readiness";

export const RECOVERY_SHOWCASE_SCENARIOS = [
  { id: "ready", label: "復旧検証OK", description: "検証済みの復旧ポイント、復元テスト、業務検証が揃った場合" },
  { id: "rpo_breach", label: "RPO超過", description: "最後の復旧ポイントが目標より古く、運用者の確認が必要な場合" },
  { id: "restore_failed", label: "復元テスト失敗", description: "復元後のデータ整合性チェックが失敗した場合" },
  { id: "restore_stale", label: "テスト期限切れ", description: "復元テスト自体は成功したが、最終検証が古い場合" },
  { id: "restore_missing", label: "復元記録なし", description: "バックアップの記録だけがあり、復元テストが実施されていない場合" },
  { id: "not_connected", label: "実証跡未接続", description: "取得元が未接続で、復旧可否を判断できない場合" },
] as const;

export type RecoveryShowcaseScenarioId = typeof RECOVERY_SHOWCASE_SCENARIOS[number]["id"];

export const projectRecoveryShowcase = (scenario: RecoveryShowcaseScenarioId, asOf: string) => {
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

  const recovery = assessRecoveryReadiness(scenario === "not_connected" ? null : evidence, asOf);
  return {
    recovery,
    actionRequired: recovery.sourceState === "available" && recovery.rpo.status === "BREACHED",
    restoreExecutionAllowed: false as const,
    resumeExecutionAllowed: false as const,
  };
};
