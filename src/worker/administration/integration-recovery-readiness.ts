import type { RuntimeEnvironment } from "../../shared/runtime";
import {
  decideOperationPolicy,
  guardOperationExecution,
  OPERATIONS_POLICY_VERSION,
  type OperationDefinition,
  type OperationRequest,
} from "../operations";

/**
 * #419 integration-specific read model backed by the shared #429 policy/guard.
 * No integration command handler is registered. This is NOT an execution preview
 * token and can never authorize a retry or provider reconciliation.
 *
 * #335 has no connected provider receipt/probe adapter, so both capabilities
 * deliberately fail closed for every local Outbox state, including "delivered".
 */
const INTEGRATION_RECONCILE: OperationDefinition = {
  id: "INTEGRATION_RECONCILE",
  capability: "integrations:reconcile",
  baseRisk: "CONTROLLED_CHANGE",
  reversible: false,
  idempotent: false,
  externalSideEffect: true,
  requiresVerification: true,
};
const DELIVERY_RETRY: OperationDefinition = {
  id: "DELIVERY_RETRY",
  capability: "integrations:retry",
  baseRisk: "CONTROLLED_CHANGE",
  reversible: false,
  idempotent: false,
  externalSideEffect: true,
  requiresVerification: true,
};

interface ReadinessInput {
  readonly environment: RuntimeEnvironment;
  readonly scopeId: string;
  readonly outboxId: string;
  readonly version: number;
  readonly requestId: string;
  readonly actorId: string;
}

const blockedOperation = (
  input: ReadinessInput,
  definition: OperationDefinition,
  blockingReason: "provider_reconcile_adapter_not_registered" | "provider_receipt_unverified",
) => {
  const request: OperationRequest = {
    definition,
    actorKind: "HUMAN",
    environment: input.environment,
    target: { resourceType: "integration_outbox", resourceId: input.outboxId, scopeId: input.scopeId },
    affectedCount: 1,
    expectedVersion: input.version,
    correlationId: input.requestId,
  };
  // No verification provider is registered. Never permit operation execution,
  // regardless of user/admin role, environment, Outbox status or state version.
  const preview = decideOperationPolicy({ allowed: false, reason: blockingReason }, request);
  const guard = guardOperationExecution({
    actorId: input.actorId,
    actorKind: "HUMAN",
    preview,
    previewPolicyVersion: OPERATIONS_POLICY_VERSION,
    evidence: {},
  });
  if (guard.allowed) throw new Error("Integration recovery guard unexpectedly allowed execution");
  if (preview.policyDecision !== "DENY" || guard.reason !== "policy_denied") {
    throw new Error("Integration recovery policy must fail closed");
  }
  return {
    operationId: definition.id,
    risk: preview.risk,
    policyDecision: preview.policyDecision,
    executable: false as const,
    guardReason: guard.reason,
    blockingReason,
  };
};

export const integrationRecoveryReadiness = (input: ReadinessInput) => ({
  kind: "policy_readiness_not_execution_preview" as const,
  policyVersion: OPERATIONS_POLICY_VERSION,
  providerOutcome: "unverified" as const,
  reconcile: blockedOperation(input, INTEGRATION_RECONCILE, "provider_reconcile_adapter_not_registered"),
  retry: blockedOperation(input, DELIVERY_RETRY, "provider_receipt_unverified"),
});
