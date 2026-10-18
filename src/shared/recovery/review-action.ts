/** #431/#429: one provider-neutral, read-only Finding/ActionRequired
 * projection used by both the authorized Recovery API and fictitious Showcase.
 * This never records an incident, grants permission or executes Recovery.
 */
import type { Finding, ActionRequired } from "../../worker/operations/types";
import type { RecoveryReadinessProjection } from "./readiness";
import type { RecoveryPlanProjection } from "./recovery-plan";

const SCOPE = "workhub-company";

export interface RecoveryReviewProjection {
  readonly finding: Finding | null;
  readonly actionRequired: ActionRequired | null;
}

/** Choose one bounded human-review reason; unknown evidence is NOT success. */
export const projectRecoveryReviewAction = (
  recovery: RecoveryReadinessProjection,
  recoveryPlan: RecoveryPlanProjection,
  asOf: string,
): RecoveryReviewProjection => {
  // Preserve existing RPO/rehearsal failure priority if both it and an
  // incident-specific failed verification have been recorded.
  const issue = recoveryPlan.evidenceSource === "verified-audit"
    && recoveryPlan.postRestore === "FAILED"
    && recovery.rpo.status !== "BREACHED"
    && recovery.postRestoreVerification !== "FAILED"
    ? { id: "recovery_incident_verification_failed",
      summary: "Audited incident post-restore verification failed",
      reason: "incident_verification_failed_requires_human_review" }
    : recovery.sourceState !== "available" ? null
      : recovery.rpo.status === "BREACHED"
        ? { id: "recovery_rpo_breach", summary: "Verified recovery point exceeds RPO",
          reason: "rpo_breach_requires_human_review" }
        : recovery.postRestoreVerification === "FAILED"
          ? { id: "recovery_restore_verification_failed", summary: "Restore verification failed",
            reason: "restore_verification_failed_requires_human_review" }
          : recovery.rto.status === "BREACHED"
            ? { id: "recovery_rto_breach", summary: "Verified rehearsal duration exceeds RTO",
              reason: "rto_breach_requires_human_review" }
            : recovery.restoreFreshness === "STALE"
              ? { id: "recovery_restore_test_stale", summary: "Restore verification is overdue",
                reason: "restore_test_stale_requires_human_review" }
              : null;
  const finding: Finding | null = issue ? {
    id: issue.id,
    resource: { resourceType: "recovery", resourceId: "workhub-recovery", scopeId: SCOPE },
    health: "DEGRADED", detectedAt: asOf, summary: issue.summary,
  } : null;
  const actionRequired: ActionRequired | null = finding && issue ? {
    findingId: finding.id, operationId: "recovery.review", reason: issue.reason,
  } : null;
  return { finding, actionRequired };
};
