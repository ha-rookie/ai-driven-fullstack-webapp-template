import type { RuntimeEnvironment } from "../../shared/runtime";

export type ActorKind = "HUMAN" | "SERVICE" | "AI_AGENT" | "SYSTEM";

export type HealthStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "UNKNOWN"
  | "STALE"
  | "NOT_MONITORED";

export type OperationRiskLevel =
  | "OBSERVE"
  | "OPERATIONAL"
  | "CONTROLLED_CHANGE"
  | "PRIVILEGED"
  | "HUMAN_GATE";

export type OperationPolicyDecision =
  | "ALLOW"
  | "ALLOW_WITH_CONFIRMATION"
  | "REQUIRE_REASON"
  | "REQUIRE_STEP_UP"
  | "REQUIRE_APPROVAL"
  | "HUMAN_GATE"
  | "DENY";

export type OperationExecutionResult =
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "REJECTED"
  | "CONFLICT"
  | "CANCELLED"
  | "UNKNOWN";

export type VerificationStatus =
  | "PENDING"
  | "PASSED"
  | "FAILED"
  | "PARTIAL"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

export interface ResourceRef {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly scopeId?: string;
}

export interface Finding {
  readonly id: string;
  readonly resource: ResourceRef;
  readonly health: HealthStatus;
  readonly detectedAt: string;
  readonly summary: string;
}

export interface ActionRequired {
  readonly findingId: string;
  readonly operationId: string;
  readonly reason: string;
}

export interface OperationDefinition {
  readonly id: string;
  readonly capability: string;
  readonly baseRisk: OperationRiskLevel;
  readonly reversible: boolean;
  readonly idempotent: boolean;
  readonly externalSideEffect: boolean;
  readonly requiresVerification: boolean;
}

export interface OperationRequest {
  readonly definition: OperationDefinition;
  readonly actorKind: ActorKind;
  readonly environment: RuntimeEnvironment;
  readonly target: ResourceRef;
  readonly affectedCount: number;
  readonly reason?: string;
  readonly correlationId: string;
  readonly expectedVersion?: number;
}

export interface OperationPreview {
  readonly operationId: string;
  readonly target: ResourceRef;
  readonly affectedCount: number;
  readonly risk: OperationRiskLevel;
  readonly policyDecision: OperationPolicyDecision;
  readonly safeguards: readonly OperationSafeguard[];
  readonly correlationId: string;
}

export type OperationSafeguard =
  | "PREVIEW"
  | "REASON"
  | "CONFIRMATION"
  | "STEP_UP"
  | "APPROVAL"
  | "AUDIT"
  | "VERIFICATION";

export interface OperationExecution {
  readonly executionId: string;
  readonly operationId: string;
  readonly target: ResourceRef;
  readonly result: OperationExecutionResult;
  readonly correlationId: string;
  readonly policyVersion: string;
}

export interface OperationVerification {
  readonly executionId: string;
  readonly status: VerificationStatus;
  readonly verifiedAt?: string;
  readonly summary?: string;
}

export interface OperationAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason?: string;
}
