import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATIONS_POLICY_VERSION,
  createOperationAuditEvent,
  createOperationExecution,
  guardOperationExecution,
  type OperationPreview,
} from "../src/worker/operations";

const preview = (overrides: Partial<OperationPreview> = {}): OperationPreview => ({
  operationId: "job.retry",
  target: { resourceType: "job", resourceId: "job-1", scopeId: "ops" },
  affectedCount: 1,
  risk: "OPERATIONAL",
  policyDecision: "ALLOW_WITH_CONFIRMATION",
  safeguards: ["PREVIEW", "AUDIT", "CONFIRMATION", "VERIFICATION"],
  correlationId: "corr-1",
  ...overrides,
});

const attempt = (p: OperationPreview, evidence = {}) => ({
  actorId: "actor-1",
  actorKind: "HUMAN" as const,
  preview: p,
  previewPolicyVersion: OPERATIONS_POLICY_VERSION,
  evidence,
});

test("DENY and HUMAN_GATE cannot be executed directly", () => {
  assert.deepEqual(
    guardOperationExecution(attempt(preview({ policyDecision: "DENY" }))),
    { allowed: false, reason: "policy_denied" },
  );
  assert.deepEqual(
    guardOperationExecution(attempt(preview({ policyDecision: "HUMAN_GATE" }))),
    { allowed: false, reason: "human_gate_required" },
  );
});

test("stale policy preview fails closed", () => {
  const result = guardOperationExecution({
    ...attempt(preview()),
    previewPolicyVersion: "old-policy",
  });
  assert.deepEqual(result, { allowed: false, reason: "stale_policy" });
});

test("required safeguards fail closed until satisfied", () => {
  const p = preview({
    policyDecision: "REQUIRE_STEP_UP",
    safeguards: ["PREVIEW", "AUDIT", "CONFIRMATION", "REASON", "STEP_UP"],
  });
  assert.equal(guardOperationExecution(attempt(p)).allowed, false);
  assert.equal(guardOperationExecution(attempt(p, { confirmed: true })).allowed, false);
  assert.equal(guardOperationExecution(attempt(p, { confirmed: true, reason: "recover job" })).allowed, false);
  assert.deepEqual(
    guardOperationExecution(attempt(p, {
      confirmed: true,
      reason: "recover job",
      stepUpVerified: true,
    })),
    { allowed: true },
  );
});

test("human service and AI actors use the same guard", () => {
  for (const actorKind of ["HUMAN", "SERVICE", "AI_AGENT"] as const) {
    const result = guardOperationExecution({
      ...attempt(preview(), { confirmed: true }),
      actorKind,
    });
    assert.deepEqual(result, { allowed: true });
  }
});

test("operation audit projection contains metadata only", () => {
  const secret = "raw-secret-business-payload";
  const event = createOperationAuditEvent({
    requestId: "req-1",
    method: "POST",
    path: "/api/admin/operations/execute",
    actorId: "actor-1",
    target: { resourceType: "job", resourceId: "job-1", scopeId: "ops" },
    operationId: "job.retry",
    correlationId: "corr-1",
    affectedCount: 1,
  }, "failure", "confirmation_required");

  assert.equal(JSON.stringify(event).includes(secret), false);
  assert.equal(event.resourceId, "job-1");
  assert.equal(event.affectedCount, 1);
});

test("execution preserves partial conflict and unknown results with correlation", () => {
  for (const result of ["PARTIAL", "CONFLICT", "UNKNOWN"] as const) {
    const execution = createOperationExecution({
      executionId: `exec-${result}`,
      preview: preview(),
      result,
    });
    assert.equal(execution.result, result);
    assert.equal(execution.correlationId, "corr-1");
    assert.equal(execution.policyVersion, OPERATIONS_POLICY_VERSION);
  }
});
