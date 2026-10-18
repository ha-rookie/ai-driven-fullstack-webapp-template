import { requireAuthenticatedUser, requireScopedAuthorization } from "../authorization";
import { apiErrorResponse } from "../http";
import { resolveWorkhubRuntimeEnvironment } from "../workhub-login";
import { canExecuteOperation, decideOperationPolicy, OPERATIONS_POLICY_VERSION } from "../operations";
import type { ActionRequired, Finding, OperationDefinition } from "../operations";
import type { RuntimeEnvironment } from "../../shared/runtime";
import { assessRecoveryReadiness, type RecoveryReadinessProjection } from "../../shared/recovery/readiness";
import { projectRecoveryPlan, type RecoveryPlanProjection } from "../../shared/recovery/recovery-plan";
import { readRecoveryAuditEvidence, unavailableRecoveryAudit,
  type RecoveryAuditEvidence } from "./recovery-audit-evidence";

/**
 * #431: read-only, fixed-scope Recovery Readiness projection. A future,
 * separately reviewed provider Adapter can supply evidence through reader.
 * No adapter is registered today: no backup/restore success is invented.
 */
const ROUTE = "/api/admin/operations/recovery-readiness";
const SCOPE = "workhub-company";
const ACTION = "administration:manage";
const POLICY = { [ACTION]: ["system_admin"] };
const RESTORE_DEFINITION: OperationDefinition = Object.freeze({
  id: "recovery.restore", capability: "recovery:restore",
  baseRisk: "HUMAN_GATE", reversible: false, idempotent: false,
  externalSideEffect: true, requiresVerification: true,
});

export type RecoveryEvidenceReader = (
  environment: RuntimeEnvironment, asOf: string,
) => Promise<unknown>;
/**
 * #431: Trusted adapter boundary for recovering a single incident's immutable
 * Audit checkpoints. This is an evidence read, not an operation executor.
 * The default adapter remains unconnected until a separately approved durable
 * recovery Audit producer is available; the generic D1 Audit count is NOT proof.
 */
export type RecoveryOperationAuditReader = (
  environment: RuntimeEnvironment, asOf: string,
) => Promise<unknown>;
/** No connection to Remote D1, Cloudflare, production backups or migration APIs. */
const readUnconnected: RecoveryEvidenceReader = async () => null;
const readUnconnectedRecoveryOperations: RecoveryOperationAuditReader = async () => null;

interface Env { readonly DB: D1Database; readonly RUNTIME_ENVIRONMENT?: string }
const reject = (requestId: string, status: number, code: string): Response =>
  apiErrorResponse({ status, code, message: status === 401 ? "Authentication required"
    : status === 403 ? "Access denied" : status === 405 ? "Method not allowed"
      : status === 400 ? "Invalid Recovery Readiness query" : "Recovery Readiness unavailable" }, requestId);

export interface RecoveryCenterResponse {
  readonly schemaVersion: 1;
  readonly scopeId: typeof SCOPE;
  readonly environment: RuntimeEnvironment;
  readonly observedAt: string;
  readonly recovery: RecoveryReadinessProjection;
  readonly recoveryPlan: RecoveryPlanProjection;
  readonly auditEvidence: RecoveryAuditEvidence;
  readonly finding: Finding | null;
  readonly actionRequired: ActionRequired | null;
  readonly restoreGate: {
    readonly operationId: "recovery.restore";
    readonly policyVersion: typeof OPERATIONS_POLICY_VERSION;
    readonly risk: "HUMAN_GATE";
    readonly policyDecision: "HUMAN_GATE";
    readonly executionAllowed: false;
  };
}

/** Explicit #429 Finding vs ActionRequired separation; never infer a breach from a missing source. */
export const projectRecoveryCenter = (
  environment: RuntimeEnvironment, asOf: string, rawEvidence: unknown,
  /** Unregistered until an approved durable Audit recovery adapter exists. */
  recoveryAuditEvidence: unknown = null,
  auditEvidence: RecoveryAuditEvidence = unavailableRecoveryAudit(),
): RecoveryCenterResponse => {
  const recovery = assessRecoveryReadiness(rawEvidence, asOf);
  const recoveryPlan = projectRecoveryPlan(recovery, environment, asOf, recoveryAuditEvidence);
  const preview = decideOperationPolicy({ allowed: true }, {
    definition: RESTORE_DEFINITION, actorKind: "HUMAN", environment,
    target: { resourceType: "recovery", resourceId: "workhub-recovery", scopeId: SCOPE },
    affectedCount: 1, correlationId: "recovery-readiness-projection",
  });
  if (preview.risk !== "HUMAN_GATE" || preview.policyDecision !== "HUMAN_GATE"
    || canExecuteOperation(preview)) {
    throw new TypeError("Recovery operation must remain behind Human Gate");
  }
  const issue = recovery.sourceState !== "available" ? null
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
    id: issue.id, resource: {
      resourceType: "recovery", resourceId: "workhub-recovery", scopeId: SCOPE,
    }, health: "DEGRADED", detectedAt: asOf, summary: issue.summary,
  } : null;
  const actionRequired: ActionRequired | null = finding && issue ? {
    findingId: finding.id, operationId: "recovery.review",
    reason: issue.reason,
  } : null;
  return {
    schemaVersion: 1, scopeId: SCOPE, environment, observedAt: asOf,
    recovery, recoveryPlan, auditEvidence, finding, actionRequired,
    restoreGate: {
      operationId: "recovery.restore", policyVersion: OPERATIONS_POLICY_VERSION,
      risk: "HUMAN_GATE", policyDecision: "HUMAN_GATE", executionAllowed: false,
    },
  };
};

export const handleRecoveryReadinessApi = async (
  request: Request, env: Env, requestId: string,
  reader: RecoveryEvidenceReader = readUnconnected,
  auditReader: RecoveryOperationAuditReader = readUnconnectedRecoveryOperations,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return null;
  if (request.method !== "GET") return reject(requestId, 405, "method_not_allowed");
  if (url.searchParams.size !== 1 || url.searchParams.getAll("scopeId").length !== 1
    || url.searchParams.get("scopeId") !== SCOPE) {
    return reject(requestId, 400, "invalid_recovery_query");
  }
  let environment: RuntimeEnvironment;
  try {
    environment = resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
  } catch { return reject(requestId, 503, "runtime_environment_required"); }
  let actorId: string;
  try {
    const auth = await requireAuthenticatedUser(request, env.DB);
    if (!auth.allowed) return reject(requestId, 401, "authentication_required");
    actorId = auth.user.id;
  } catch { return reject(requestId, 503, "authentication_unavailable"); }
  try {
    const authz = await requireScopedAuthorization({
      db: env.DB, userId: actorId, action: ACTION, policy: POLICY,
      requestedScopeId: SCOPE, resourceScopeId: SCOPE,
    });
    if (!authz.allowed) return reject(requestId, 403, "forbidden");
  } catch { return reject(requestId, 503, "authorization_unavailable"); }

  const asOf = new Date().toISOString();
  let evidence: unknown;
  try { evidence = await reader(environment, asOf); }
  catch { evidence = undefined; } // UNKNOWN, not healthy or verified.
  // A future trusted adapter can rehydrate independently audited incident
  // checkpoints after a browser restart. Missing adapter => not-connected;
  // adapter failure/malformed response => unavailable, never a false resume.
  let incidentAudit: unknown;
  try {
    incidentAudit = await auditReader(environment, asOf);
  } catch {
    incidentAudit = { adapterUnavailable: true };
  }
  if (incidentAudit === undefined) incidentAudit = { adapterUnavailable: true };
  // Existing D1 Audit coverage is independent. It is not incident verification.
  const auditEvidence = await readRecoveryAuditEvidence(env.DB, environment, asOf);
  try {
    return Response.json(projectRecoveryCenter(environment, asOf, evidence, incidentAudit, auditEvidence), {
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  } catch { return reject(requestId, 503, "recovery_projection_unavailable"); }
};
