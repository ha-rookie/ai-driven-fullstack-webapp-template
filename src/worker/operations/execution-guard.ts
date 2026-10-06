import type { AuditEvent, AuditLogger } from "../audit";
import { OPERATIONS_POLICY_VERSION } from "./policy";
import type {
  ActorKind,
  OperationExecution,
  OperationExecutionResult,
  OperationPreview,
  OperationSafeguard,
  ResourceRef,
} from "./types";

export interface OperationSafeguardEvidence {
  readonly confirmed?: boolean;
  readonly reason?: string;
  readonly stepUpVerified?: boolean;
  readonly approvalId?: string;
}

export interface OperationExecutionAttempt {
  readonly actorId: string;
  readonly actorKind: ActorKind;
  readonly preview: OperationPreview;
  readonly previewPolicyVersion: string;
  readonly evidence: OperationSafeguardEvidence;
}

export type OperationGuardRejectionReason =
  | "policy_denied"
  | "human_gate_required"
  | "stale_policy"
  | "confirmation_required"
  | "reason_required"
  | "step_up_required"
  | "approval_required";

export type OperationGuardDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: OperationGuardRejectionReason };

const nonBlank = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

export const guardOperationExecution = (
  attempt: OperationExecutionAttempt,
): OperationGuardDecision => {
  if (attempt.previewPolicyVersion !== OPERATIONS_POLICY_VERSION) {
    return { allowed: false, reason: "stale_policy" };
  }
  if (attempt.preview.policyDecision === "DENY") {
    return { allowed: false, reason: "policy_denied" };
  }
  if (attempt.preview.policyDecision === "HUMAN_GATE") {
    return { allowed: false, reason: "human_gate_required" };
  }

  const required = new Set<OperationSafeguard>(attempt.preview.safeguards);
  if (required.has("CONFIRMATION") && attempt.evidence.confirmed !== true) {
    return { allowed: false, reason: "confirmation_required" };
  }
  if (required.has("REASON") && !nonBlank(attempt.evidence.reason)) {
    return { allowed: false, reason: "reason_required" };
  }
  if (required.has("STEP_UP") && attempt.evidence.stepUpVerified !== true) {
    return { allowed: false, reason: "step_up_required" };
  }
  if (required.has("APPROVAL") && !nonBlank(attempt.evidence.approvalId)) {
    return { allowed: false, reason: "approval_required" };
  }
  return { allowed: true };
};

export interface OperationAuditMetadata {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly actorId: string;
  readonly target: ResourceRef;
  readonly operationId: string;
  readonly correlationId: string;
  readonly affectedCount: number;
}

export const createOperationAuditEvent = (
  metadata: OperationAuditMetadata,
  outcome: "success" | "failure",
  reason?: string,
): AuditEvent => ({
  requestId: metadata.requestId,
  method: metadata.method,
  path: metadata.path,
  category: "system",
  action: `operation.${metadata.operationId}`,
  outcome,
  actorId: metadata.actorId,
  scopeId: metadata.target.scopeId,
  resourceType: metadata.target.resourceType,
  resourceId: metadata.target.resourceId,
  affectedCount: metadata.affectedCount,
  ...(reason ? { reason } : {}),
});

export const writeOperationAudit = (
  logger: AuditLogger,
  metadata: OperationAuditMetadata,
  outcome: "success" | "failure",
  reason?: string,
): void => {
  logger.write(createOperationAuditEvent(metadata, outcome, reason));
};

export const createOperationExecution = (input: {
  readonly executionId: string;
  readonly preview: OperationPreview;
  readonly result: OperationExecutionResult;
}): OperationExecution => ({
  executionId: input.executionId,
  operationId: input.preview.operationId,
  target: input.preview.target,
  result: input.result,
  correlationId: input.preview.correlationId,
  policyVersion: OPERATIONS_POLICY_VERSION,
});
