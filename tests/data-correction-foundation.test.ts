import assert from "node:assert/strict";
import test from "node:test";

import {
  DataCorrectionRegistry,
  createDataCorrectionOperationHandler,
  type DataCorrectionAdapter,
} from "../src/worker/administration";
import {
  OperationRegistry,
  OperationsApplicationService,
  OPERATIONS_POLICY_VERSION,
} from "../src/worker/operations";

const adapter: DataCorrectionAdapter = {
  definition: {
    key: "RESTORE_SOFT_DELETED_RESOURCE",
    version: 1,
    capability: "data_correction:restore",
    risk: "CONTROLLED_CHANGE",
    reversible: true,
    idempotent: false,
    requiresReason: true,
    supportsPreview: true,
    requiresVerification: true,
  },
  async execute(input) {
    return {
      result: "SUCCESS",
      before: {
        resourceType: "example_resource",
        resourceId: input.targetId,
        version: input.expectedVersion,
        state: { deleted: true },
      },
      after: {
        resourceType: "example_resource",
        resourceId: input.targetId,
        version: input.expectedVersion + 1,
        state: { deleted: false },
      },
    };
  },
  async verify() {
    return { passed: true, summary: "verified" };
  },
};

test("data correction registry rejects duplicate command keys", () => {
  assert.throws(
    () => new DataCorrectionRegistry([adapter, adapter]),
    /Duplicate data correction command/u,
  );
});

test("controlled correction requires reason and confirmation through Operations Core", async () => {
  const handler = createDataCorrectionOperationHandler({
    adapter,
    actorId: "operator-1",
    expectedVersion: 4,
  });
  const events: unknown[] = [];
  const service = new OperationsApplicationService(
    new OperationRegistry([handler]),
    { write: (event) => events.push(event) },
  );
  const request = {
    definition: handler.definition,
    actorKind: "HUMAN" as const,
    environment: "preview" as const,
    target: { resourceType: "example_resource", resourceId: "resource-1", scopeId: "scope-1" },
    affectedCount: 1,
    expectedVersion: 4,
    reason: "restore resource after operator validation",
    correlationId: "corr-1",
  };

  const preview = service.preview({ allowed: true }, request);
  assert.equal(preview.policyDecision, "REQUIRE_REASON");
  assert.deepEqual(
    preview.safeguards,
    ["PREVIEW", "AUDIT", "CONFIRMATION", "REASON", "VERIFICATION"],
  );

  const rejected = await service.execute(request, preview, {
    actorId: "operator-1",
    requestContext: { requestId: "req-1", method: "POST", path: "/api/admin/data-corrections" },
    previewPolicyVersion: OPERATIONS_POLICY_VERSION,
    evidence: { confirmed: false, reason: request.reason },
    executionId: "exec-1",
  });
  assert.equal(rejected.execution.result, "REJECTED");

  const accepted = await service.execute(request, preview, {
    actorId: "operator-1",
    requestContext: { requestId: "req-2", method: "POST", path: "/api/admin/data-corrections" },
    previewPolicyVersion: OPERATIONS_POLICY_VERSION,
    evidence: { confirmed: true, reason: request.reason },
    executionId: "exec-2",
  });
  assert.equal(accepted.execution.result, "SUCCESS");
  assert.equal(accepted.verification.status, "PASSED");
  assert.equal(events.length, 2);
});

test("expectedVersion mismatch fails closed before correction adapter executes", async () => {
  let executed = 0;
  const guardedAdapter: DataCorrectionAdapter = {
    ...adapter,
    execute: async () => {
      executed += 1;
      return { result: "SUCCESS" };
    },
  };
  const handler = createDataCorrectionOperationHandler({
    adapter: guardedAdapter,
    actorId: "operator-1",
    expectedVersion: 4,
  });

  const result = await handler.execute({
    definition: handler.definition,
    actorKind: "HUMAN",
    environment: "preview",
    target: { resourceType: "example_resource", resourceId: "resource-1", scopeId: "scope-1" },
    affectedCount: 1,
    expectedVersion: 3,
    reason: "stale correction request",
    correlationId: "corr-2",
  });

  assert.equal(result.result, "CONFLICT");
  assert.equal(executed, 0);
});

test("Production controlled correction remains Human Gate", async () => {
  const handler = createDataCorrectionOperationHandler({
    adapter,
    actorId: "operator-1",
    expectedVersion: 4,
  });
  const service = new OperationsApplicationService(
    new OperationRegistry([handler]),
    { write: () => undefined },
  );
  const request = {
    definition: handler.definition,
    actorKind: "HUMAN" as const,
    environment: "production" as const,
    target: { resourceType: "example_resource", resourceId: "resource-1", scopeId: "scope-1" },
    affectedCount: 1,
    expectedVersion: 4,
    reason: "restore",
    correlationId: "corr-3",
  };
  const preview = service.preview({ allowed: true }, request);
  assert.equal(preview.policyDecision, "HUMAN_GATE");

  const result = await service.execute(request, preview, {
    actorId: "operator-1",
    requestContext: { requestId: "req-3", method: "POST", path: "/api/admin/data-corrections" },
    previewPolicyVersion: OPERATIONS_POLICY_VERSION,
    evidence: { confirmed: true, reason: request.reason, approvalId: "approval-1" },
    executionId: "exec-3",
  });
  assert.equal(result.execution.result, "REJECTED");
});
