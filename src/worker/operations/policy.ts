import type {
  OperationAuthorizationDecision,
  OperationPolicyDecision,
  OperationPreview,
  OperationRequest,
  OperationRiskLevel,
  OperationSafeguard,
} from "./types";

export const OPERATIONS_POLICY_VERSION = "operations-policy-v1";

const rank: Record<OperationRiskLevel, number> = {
  OBSERVE: 0,
  OPERATIONAL: 1,
  CONTROLLED_CHANGE: 2,
  PRIVILEGED: 3,
  HUMAN_GATE: 4,
};

const levelAtLeast = (
  left: OperationRiskLevel,
  right: OperationRiskLevel,
): boolean => rank[left] >= rank[right];

export const assessOperationRisk = (
  request: OperationRequest,
): OperationRiskLevel => {
  let risk = request.definition.baseRisk;

  if (request.environment === "production" && levelAtLeast(risk, "CONTROLLED_CHANGE")) {
    risk = "HUMAN_GATE";
  } else if (request.affectedCount > 100 && levelAtLeast(risk, "OPERATIONAL")) {
    risk = "PRIVILEGED";
  } else if (
    request.definition.externalSideEffect &&
    levelAtLeast(risk, "OPERATIONAL") &&
    !levelAtLeast(risk, "CONTROLLED_CHANGE")
  ) {
    risk = "CONTROLLED_CHANGE";
  }

  if (request.actorKind === "AI_AGENT" && levelAtLeast(risk, "CONTROLLED_CHANGE")) {
    risk = "HUMAN_GATE";
  }

  return risk;
};

export const decideOperationPolicy = (
  authorization: OperationAuthorizationDecision,
  request: OperationRequest,
): OperationPreview => {
  const risk = assessOperationRisk(request);

  if (!authorization.allowed) {
    return {
      operationId: request.definition.id,
      target: request.target,
      affectedCount: request.affectedCount,
      risk,
      policyDecision: "DENY",
      safeguards: ["PREVIEW", "AUDIT"],
      correlationId: request.correlationId,
    };
  }

  let policyDecision: OperationPolicyDecision;
  if (risk === "HUMAN_GATE") policyDecision = "HUMAN_GATE";
  else if (risk === "PRIVILEGED") policyDecision = "REQUIRE_STEP_UP";
  else if (risk === "CONTROLLED_CHANGE") policyDecision = "REQUIRE_REASON";
  else if (risk === "OPERATIONAL") policyDecision = "ALLOW_WITH_CONFIRMATION";
  else policyDecision = "ALLOW";

  const safeguards: OperationSafeguard[] = ["PREVIEW", "AUDIT"];
  if (levelAtLeast(risk, "OPERATIONAL")) safeguards.push("CONFIRMATION");
  if (levelAtLeast(risk, "CONTROLLED_CHANGE")) safeguards.push("REASON");
  if (risk === "PRIVILEGED") safeguards.push("STEP_UP");
  if (risk === "HUMAN_GATE") safeguards.push("APPROVAL");
  if (request.definition.requiresVerification) safeguards.push("VERIFICATION");

  return {
    operationId: request.definition.id,
    target: request.target,
    affectedCount: request.affectedCount,
    risk,
    policyDecision,
    safeguards,
    correlationId: request.correlationId,
  };
};

export const canExecuteOperation = (
  preview: OperationPreview,
): boolean =>
  preview.policyDecision === "ALLOW" ||
  preview.policyDecision === "ALLOW_WITH_CONFIRMATION" ||
  preview.policyDecision === "REQUIRE_REASON";
