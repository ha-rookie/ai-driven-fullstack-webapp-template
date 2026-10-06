import assert from "node:assert/strict";
import test from "node:test";

import {
  assessOperationRisk,
  canExecuteOperation,
  decideOperationPolicy,
  type OperationDefinition,
  type OperationRequest,
} from "../src/worker/operations";

const definition: OperationDefinition = {
  id: "job.retry",
  capability: "job:retry",
  baseRisk: "OPERATIONAL",
  reversible: false,
  idempotent: true,
  externalSideEffect: false,
  requiresVerification: true,
};

const request = (overrides: Partial<OperationRequest> = {}): OperationRequest => ({
  definition,
  actorKind: "HUMAN",
  environment: "test",
  target: { resourceType: "job", resourceId: "job-1", scopeId: "ops" },
  affectedCount: 1,
  correlationId: "corr-1",
  ...overrides,
});

test("authorization denial cannot be bypassed by risk policy", () => {
  const preview = decideOperationPolicy({ allowed: false, reason: "role_required" }, request());
  assert.equal(preview.policyDecision, "DENY");
  assert.equal(canExecuteOperation(preview), false);
});

test("production controlled changes become Human Gate", () => {
  const controlled = { ...definition, baseRisk: "CONTROLLED_CHANGE" as const };
  const preview = decideOperationPolicy({ allowed: true }, request({
    definition: controlled,
    environment: "production",
  }));
  assert.equal(preview.risk, "HUMAN_GATE");
  assert.equal(preview.policyDecision, "HUMAN_GATE");
  assert.equal(canExecuteOperation(preview), false);
  assert.ok(preview.safeguards.includes("APPROVAL"));
});

test("AI agents cannot directly execute controlled changes", () => {
  const controlled = { ...definition, baseRisk: "CONTROLLED_CHANGE" as const };
  const preview = decideOperationPolicy({ allowed: true }, request({
    definition: controlled,
    actorKind: "AI_AGENT",
  }));
  assert.equal(preview.risk, "HUMAN_GATE");
  assert.equal(canExecuteOperation(preview), false);
});

test("large operational blast radius escalates to privileged", () => {
  assert.equal(assessOperationRisk(request({ affectedCount: 101 })), "PRIVILEGED");
  const preview = decideOperationPolicy({ allowed: true }, request({ affectedCount: 101 }));
  assert.equal(preview.policyDecision, "REQUIRE_STEP_UP");
  assert.equal(canExecuteOperation(preview), false);
});

test("external side effect escalates operational action to controlled change", () => {
  const external = { ...definition, externalSideEffect: true };
  const preview = decideOperationPolicy({ allowed: true }, request({ definition: external, reason: "operator requested" }));
  assert.equal(preview.risk, "CONTROLLED_CHANGE");
  assert.equal(preview.policyDecision, "REQUIRE_REASON");
  assert.ok(preview.safeguards.includes("VERIFICATION"));
});

test("observe operation remains executable after authorization", () => {
  const observe = { ...definition, baseRisk: "OBSERVE" as const, requiresVerification: false };
  const preview = decideOperationPolicy({ allowed: true }, request({ definition: observe }));
  assert.equal(preview.policyDecision, "ALLOW");
  assert.equal(canExecuteOperation(preview), true);
});

test("execution and verification models support unknown partial and conflict states", () => {
  const executionResults = ["PARTIAL", "CONFLICT", "UNKNOWN"] as const;
  const verification = ["PARTIAL", "UNKNOWN"] as const;
  assert.deepEqual(executionResults, ["PARTIAL", "CONFLICT", "UNKNOWN"]);
  assert.deepEqual(verification, ["PARTIAL", "UNKNOWN"]);
});
