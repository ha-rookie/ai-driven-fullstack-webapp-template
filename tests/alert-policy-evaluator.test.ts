import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAlertPolicy,
  initialAlertPolicyState,
  type AlertPolicy,
  type AlertPolicyState,
} from "../src/shared/observability";

const latencyPolicy = (overrides: Partial<AlertPolicy> = {}): AlertPolicy => ({
  id: "api_latency",
  environment: "production",
  component: "worker.http",
  severity: "warning",
  condition: {
    kind: "metric_threshold",
    signal: "request_latency_p95",
    operator: "gte",
    threshold: 500,
  },
  requiredConsecutive: 3,
  minimumDurationMs: 1_000,
  cooldownMs: 5_000,
  ...overrides,
});

const metricObservation = (
  observedAtMs: number,
  value: number,
  overrides: Record<string, unknown> = {},
) => ({
  kind: "metric" as const,
  observedAtMs,
  environment: "production" as const,
  component: "worker.http",
  signal: "request_latency_p95",
  value,
  requestId: "request-safe-1",
  ...overrides,
});

test("threshold alert requires both configured consecutive observations and duration", () => {
  const policy = latencyPolicy();
  let state = initialAlertPolicyState();

  const first = evaluateAlertPolicy(policy, state, metricObservation(0, 600));
  assert.equal(first.kind, "none");
  assert.equal(first.reason, "condition_not_mature");
  state = first.state;

  const second = evaluateAlertPolicy(policy, state, metricObservation(500, 700));
  assert.equal(second.kind, "none");
  state = second.state;

  const third = evaluateAlertPolicy(policy, state, metricObservation(1_000, 800));
  assert.equal(third.kind, "candidate");
  if (third.kind !== "candidate") throw new Error("expected candidate");
  assert.equal(third.candidate.event, "trigger");
  assert.equal(third.candidate.policyId, "api_latency");
  assert.equal(third.candidate.requestId, "request-safe-1");
  assert.equal(third.state.active, true);
});

test("active alert suppresses duplicates until cooldown then emits repeat", () => {
  const policy = latencyPolicy({ requiredConsecutive: 1, minimumDurationMs: 0, cooldownMs: 2_000 });
  const triggered = evaluateAlertPolicy(policy, initialAlertPolicyState(), metricObservation(1_000, 700));
  assert.equal(triggered.kind, "candidate");
  const activeState = triggered.state;

  const withinCooldown = evaluateAlertPolicy(policy, activeState, metricObservation(2_000, 700));
  assert.equal(withinCooldown.kind, "none");
  assert.equal(withinCooldown.reason, "cooldown");

  const repeat = evaluateAlertPolicy(policy, withinCooldown.state, metricObservation(3_000, 700));
  assert.equal(repeat.kind, "candidate");
  if (repeat.kind !== "candidate") throw new Error("expected repeat");
  assert.equal(repeat.candidate.event, "repeat");
});

test("recovery emits a resolve candidate and clears state", () => {
  const policy = latencyPolicy({ requiredConsecutive: 1, minimumDurationMs: 0 });
  const triggered = evaluateAlertPolicy(policy, initialAlertPolicyState(), metricObservation(100, 900));
  const resolved = evaluateAlertPolicy(policy, triggered.state, metricObservation(200, 100));

  assert.equal(resolved.kind, "candidate");
  if (resolved.kind !== "candidate") throw new Error("expected resolve");
  assert.equal(resolved.candidate.event, "resolve");
  assert.deepEqual(resolved.state, initialAlertPolicyState());
});

test("preview and production policies do not share observations", () => {
  const policy = latencyPolicy({ environment: "preview" });
  const result = evaluateAlertPolicy(
    policy,
    initialAlertPolicyState(),
    metricObservation(0, 999, { environment: "production" }),
  );

  assert.equal(result.kind, "none");
  assert.equal(result.reason, "not_applicable");
  assert.deepEqual(result.state, initialAlertPolicyState());
});

test("maintenance/read-only suppression expires so a persistent breach cannot be hidden forever", () => {
  const policy = latencyPolicy({
    requiredConsecutive: 1,
    minimumDurationMs: 0,
    suppression: {
      operationModes: ["maintenance", "read-only"],
      maxDurationMs: 5_000,
    },
  });

  const suppressed = evaluateAlertPolicy(
    policy,
    initialAlertPolicyState(),
    metricObservation(0, 900, { operationMode: "maintenance" }),
  );
  assert.equal(suppressed.kind, "suppressed");
  assert.equal(suppressed.state.active, false);

  const expired = evaluateAlertPolicy(
    policy,
    suppressed.state,
    metricObservation(5_000, 900, { operationMode: "maintenance" }),
  );
  assert.equal(expired.kind, "candidate");
  if (expired.kind !== "candidate") throw new Error("expected trigger after suppression expiry");
  assert.equal(expired.candidate.event, "trigger");
});

test("health unavailable can use the same state transition contract", () => {
  const policy: AlertPolicy = {
    id: "database_health",
    environment: "production",
    component: "database",
    severity: "critical",
    condition: { kind: "health_unavailable", signal: "readiness" },
    requiredConsecutive: 2,
    minimumDurationMs: 100,
    cooldownMs: 10_000,
  };
  let state: AlertPolicyState = initialAlertPolicyState();

  const first = evaluateAlertPolicy(policy, state, {
    kind: "health",
    observedAtMs: 0,
    environment: "production",
    component: "database",
    signal: "readiness",
    status: "unavailable",
  });
  state = first.state;
  assert.equal(first.kind, "none");

  const second = evaluateAlertPolicy(policy, state, {
    kind: "health",
    observedAtMs: 100,
    environment: "production",
    component: "database",
    signal: "readiness",
    status: "unavailable",
  });
  assert.equal(second.kind, "candidate");
  if (second.kind !== "candidate") throw new Error("expected health trigger");
  assert.equal(second.candidate.event, "trigger");
});

test("unsafe high-cardinality policy/context values are rejected", () => {
  assert.throws(
    () => evaluateAlertPolicy(
      latencyPolicy({ component: "/api/users/123" }),
      initialAlertPolicyState(),
      metricObservation(0, 999),
    ),
    /low-cardinality/,
  );

  assert.throws(
    () => evaluateAlertPolicy(
      latencyPolicy(),
      initialAlertPolicyState(),
      metricObservation(0, 999, { requestId: "unsafe request id" }),
    ),
    /requestId/,
  );
});

test("observations moving backwards in time are rejected instead of corrupting cooldown state", () => {
  const policy = latencyPolicy({ requiredConsecutive: 1, minimumDurationMs: 0 });
  const triggered = evaluateAlertPolicy(policy, initialAlertPolicyState(), metricObservation(1_000, 900));

  assert.throws(
    () => evaluateAlertPolicy(policy, triggered.state, metricObservation(999, 900)),
    /backwards/,
  );
});
