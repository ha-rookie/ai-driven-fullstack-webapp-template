import { isRuntimeEnvironment } from "../runtime";
import {
  isSafeMetricCorrelationId,
  isSafeMetricDimension,
  type MetricsEnvironment,
} from "./metrics";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertOperationMode = "normal" | "read-only" | "maintenance";
export type AlertThresholdOperator = "gt" | "gte" | "lt" | "lte";

export interface MetricThresholdAlertCondition {
  readonly kind: "metric_threshold";
  readonly signal: string;
  readonly operator: AlertThresholdOperator;
  readonly threshold: number;
}

export interface HealthUnavailableAlertCondition {
  readonly kind: "health_unavailable";
  readonly signal: string;
}

export type AlertCondition = MetricThresholdAlertCondition | HealthUnavailableAlertCondition;

export interface AlertSuppressionPolicy {
  readonly operationModes: readonly ("read-only" | "maintenance")[];
  /** Suppression expires even if the operation mode remains active. */
  readonly maxDurationMs: number;
}

export interface AlertPolicy {
  readonly id: string;
  readonly environment: Exclude<MetricsEnvironment, "unknown">;
  readonly component: string;
  readonly severity: AlertSeverity;
  readonly condition: AlertCondition;
  readonly requiredConsecutive: number;
  readonly minimumDurationMs: number;
  /** Re-emission interval while the same alert remains active. */
  readonly cooldownMs: number;
  readonly suppression?: AlertSuppressionPolicy;
}

interface AlertObservationBase {
  readonly observedAtMs: number;
  readonly environment: MetricsEnvironment;
  readonly component: string;
  readonly signal: string;
  readonly requestId?: string;
  readonly operationMode?: AlertOperationMode;
}

export interface MetricAlertObservation extends AlertObservationBase {
  readonly kind: "metric";
  readonly value: number;
}

export interface HealthAlertObservation extends AlertObservationBase {
  readonly kind: "health";
  readonly status: "ok" | "unavailable";
}

export type AlertObservation = MetricAlertObservation | HealthAlertObservation;

export interface AlertPolicyState {
  readonly consecutiveBreaches: number;
  readonly breachStartedAtMs: number | null;
  readonly active: boolean;
  readonly lastCandidateAtMs: number | null;
}

export const initialAlertPolicyState = (): AlertPolicyState => Object.freeze({
  consecutiveBreaches: 0,
  breachStartedAtMs: null,
  active: false,
  lastCandidateAtMs: null,
});

export type AlertEventType = "trigger" | "repeat" | "resolve";

export interface AlertCandidate {
  readonly kind: "alert_candidate";
  readonly event: AlertEventType;
  readonly policyId: string;
  readonly severity: AlertSeverity;
  readonly environment: Exclude<MetricsEnvironment, "unknown">;
  readonly component: string;
  readonly signal: string;
  readonly observedAtMs: number;
  readonly requestId?: string;
}

export type AlertEvaluationReason =
  | "not_applicable"
  | "condition_not_mature"
  | "cooldown"
  | "operation_mode";

export type AlertPolicyEvaluation =
  | {
      readonly kind: "none";
      readonly reason: Exclude<AlertEvaluationReason, "operation_mode">;
      readonly state: AlertPolicyState;
    }
  | {
      readonly kind: "suppressed";
      readonly reason: "operation_mode";
      readonly state: AlertPolicyState;
    }
  | {
      readonly kind: "candidate";
      readonly candidate: AlertCandidate;
      readonly state: AlertPolicyState;
    };

const requireDimension = (value: unknown, field: string): string => {
  if (!isSafeMetricDimension(value)) {
    throw new TypeError(`${field} must be a declared low-cardinality identifier`);
  }
  return value;
};

const requireFiniteNonNegative = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite non-negative number`);
  }
  return value;
};

const validatePolicy = (policy: AlertPolicy): void => {
  requireDimension(policy.id, "policy.id");
  requireDimension(policy.component, "policy.component");
  requireDimension(policy.condition.signal, "policy.condition.signal");
  if (!isRuntimeEnvironment(policy.environment)) {
    throw new TypeError("policy.environment must be a concrete runtime environment");
  }
  if (!Number.isInteger(policy.requiredConsecutive) || policy.requiredConsecutive < 1) {
    throw new TypeError("policy.requiredConsecutive must be an integer >= 1");
  }
  requireFiniteNonNegative(policy.minimumDurationMs, "policy.minimumDurationMs");
  requireFiniteNonNegative(policy.cooldownMs, "policy.cooldownMs");
  if (policy.condition.kind === "metric_threshold") {
    if (!Number.isFinite(policy.condition.threshold)) {
      throw new TypeError("policy.condition.threshold must be finite");
    }
  }
  if (policy.suppression) {
    requireFiniteNonNegative(policy.suppression.maxDurationMs, "policy.suppression.maxDurationMs");
    if (policy.suppression.operationModes.length === 0) {
      throw new TypeError("policy.suppression.operationModes must not be empty");
    }
    for (const mode of policy.suppression.operationModes) {
      if (mode !== "read-only" && mode !== "maintenance") {
        throw new TypeError("only read-only or maintenance may suppress alerts");
      }
    }
  }
};

const validateObservation = (observation: AlertObservation): void => {
  requireFiniteNonNegative(observation.observedAtMs, "observation.observedAtMs");
  requireDimension(observation.component, "observation.component");
  requireDimension(observation.signal, "observation.signal");
  if (observation.requestId !== undefined && !isSafeMetricCorrelationId(observation.requestId)) {
    throw new TypeError("observation.requestId is invalid");
  }
  if (observation.kind === "metric" && !Number.isFinite(observation.value)) {
    throw new TypeError("observation.value must be finite");
  }
};

const validateState = (state: AlertPolicyState): void => {
  if (!Number.isInteger(state.consecutiveBreaches) || state.consecutiveBreaches < 0) {
    throw new TypeError("state.consecutiveBreaches is invalid");
  }
  for (const [field, value] of [
    ["state.breachStartedAtMs", state.breachStartedAtMs],
    ["state.lastCandidateAtMs", state.lastCandidateAtMs],
  ] as const) {
    if (value !== null) requireFiniteNonNegative(value, field);
  }
};

const compare = (value: number, operator: AlertThresholdOperator, threshold: number): boolean => {
  switch (operator) {
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
  }
};

const matchesCondition = (policy: AlertPolicy, observation: AlertObservation): boolean => {
  if (policy.condition.kind === "metric_threshold") {
    return observation.kind === "metric" &&
      compare(observation.value, policy.condition.operator, policy.condition.threshold);
  }
  return observation.kind === "health" && observation.status === "unavailable";
};

const appliesTo = (policy: AlertPolicy, observation: AlertObservation): boolean =>
  observation.environment === policy.environment &&
  observation.component === policy.component &&
  observation.signal === policy.condition.signal &&
  ((policy.condition.kind === "metric_threshold" && observation.kind === "metric") ||
    (policy.condition.kind === "health_unavailable" && observation.kind === "health"));

const makeCandidate = (
  policy: AlertPolicy,
  observation: AlertObservation,
  event: AlertEventType,
): AlertCandidate => Object.freeze({
  kind: "alert_candidate",
  event,
  policyId: policy.id,
  severity: policy.severity,
  environment: policy.environment,
  component: policy.component,
  signal: policy.condition.signal,
  observedAtMs: observation.observedAtMs,
  ...(observation.requestId ? { requestId: observation.requestId } : {}),
});

const resetState = initialAlertPolicyState;

/**
 * Pure alert state transition. Callers own persistence of `state`; Core never assumes one
 * Worker isolate or one monitoring vendor is authoritative for duration/cooldown state.
 */
export const evaluateAlertPolicy = (
  policy: AlertPolicy,
  state: AlertPolicyState,
  observation: AlertObservation,
): AlertPolicyEvaluation => {
  validatePolicy(policy);
  validateState(state);
  validateObservation(observation);

  if (!appliesTo(policy, observation)) {
    return { kind: "none", reason: "not_applicable", state };
  }

  const latestStateTimestamp = Math.max(
    state.breachStartedAtMs ?? 0,
    state.lastCandidateAtMs ?? 0,
  );
  if (observation.observedAtMs < latestStateTimestamp) {
    throw new RangeError("alert observations must not move backwards in time");
  }

  const breached = matchesCondition(policy, observation);
  if (!breached) {
    if (!state.active) {
      return { kind: "none", reason: "condition_not_mature", state: resetState() };
    }
    const next = resetState();
    return {
      kind: "candidate",
      candidate: makeCandidate(policy, observation, "resolve"),
      state: next,
    };
  }

  const breachStartedAtMs = state.breachStartedAtMs ?? observation.observedAtMs;
  const consecutiveBreaches = state.consecutiveBreaches + 1;
  const breachedForMs = observation.observedAtMs - breachStartedAtMs;
  const pendingState: AlertPolicyState = Object.freeze({
    consecutiveBreaches,
    breachStartedAtMs,
    active: state.active,
    lastCandidateAtMs: state.lastCandidateAtMs,
  });

  if (
    consecutiveBreaches < policy.requiredConsecutive ||
    breachedForMs < policy.minimumDurationMs
  ) {
    return { kind: "none", reason: "condition_not_mature", state: pendingState };
  }

  if (
    policy.suppression &&
    observation.operationMode !== undefined &&
    policy.suppression.operationModes.includes(
      observation.operationMode as "read-only" | "maintenance",
    ) &&
    breachedForMs < policy.suppression.maxDurationMs
  ) {
    return { kind: "suppressed", reason: "operation_mode", state: pendingState };
  }

  if (!state.active) {
    const next: AlertPolicyState = Object.freeze({
      ...pendingState,
      active: true,
      lastCandidateAtMs: observation.observedAtMs,
    });
    return {
      kind: "candidate",
      candidate: makeCandidate(policy, observation, "trigger"),
      state: next,
    };
  }

  const lastCandidateAtMs = state.lastCandidateAtMs ?? observation.observedAtMs;
  if (observation.observedAtMs - lastCandidateAtMs < policy.cooldownMs) {
    return { kind: "none", reason: "cooldown", state: pendingState };
  }

  const next: AlertPolicyState = Object.freeze({
    ...pendingState,
    active: true,
    lastCandidateAtMs: observation.observedAtMs,
  });
  return {
    kind: "candidate",
    candidate: makeCandidate(policy, observation, "repeat"),
    state: next,
  };
};
