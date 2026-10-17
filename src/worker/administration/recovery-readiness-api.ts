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
/** No connection to Remote D1, Cloudflare, production backups or migration APIs. */
const readUnconnected: RecoveryEvidenceReader = async () => null;

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
  const breached = recovery.sourceState === "available" && recovery.rpo.status === "BREACHED";
  const finding: Finding | null = breached ? {
    id: "recovery_rpo_breach", resource: {
      resourceType: "recovery", resourceId: "workhub-recovery", scopeId: SCOPE,
    }, health: "DEGRADED", detectedAt: asOf,
    summary: "Verified recovery point age exceeds the configured RPO",
  } : null;
  const actionRequired: ActionRequired | null = finding ? {
    findingId: finding.id, operationId: "recovery.review",
    reason: "rpo_breach_requires_human_review",
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
  // Real read of existing durable D1 Audit rows. Never turns backup readiness
  // green and never consumes untrusted HTTP-provided Audit evidence.
  const auditEvidence = await readRecoveryAuditEvidence(env.DB, environment, asOf);
  try {
    return Response.json(projectRecoveryCenter(environment, asOf, evidence, null, auditEvidence), {
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  } catch { return reject(requestId, 503, "recovery_projection_unavailable"); }
};
