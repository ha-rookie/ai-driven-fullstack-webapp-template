import assert from "node:assert/strict";
import test from "node:test";

import {
  JOB_RETRY_OPERATION,
  JobRecoveryRegistry,
  createJobRetryOperationHandler,
  type RecoverableJobRecord,
} from "../src/worker/administration";
import {
  OperationRegistry,
  OperationsApplicationService,
  OPERATIONS_POLICY_VERSION,
} from "../src/worker/operations";

const job: RecoverableJobRecord = {
  jobId: "job-1",
  type: "example.recoverable",
  idempotencyKey: "job-1",
  state: "failed",
  attempt: 3,
  updatedAt: "2026-10-08T00:00:00.000Z",
  failureCode: "example_failure",
};

test("job recovery registry rejects duplicate job types", () => {
  const adapter = {
    jobType: "example.recoverable",
    recover: async () => ({ result: "SUCCESS" as const }),
  };
  assert.throws(
    () => new JobRecoveryRegistry([adapter, adapter]),
    /Duplicate job recovery adapter/u,
  );
});

test("JOB_RETRY uses Operations Core reason and confirmation safeguards", async () => {
  let recovered = 0;
  const adapter = {
    jobType: "example.recoverable",
    recover: async () => {
      recovered += 1;
      return { result: "SUCCESS" as const };
    },
  };
  const handler = createJobRetryOperationHandler({
    environment: "preview",
    job,
    adapter,
  });
  const events: unknown[] = [];
  const service = new OperationsApplicationService(
    new OperationRegistry([handler]),
    { write: (event) => events.push(event) },
  );
  const request = {
    definition: JOB_RETRY_OPERATION,
    actorKind: "HUMAN" as const,
    environment: "preview" as const,
    target: { resourceType: "async_job", resourceId: job.jobId, scopeId: "scope-1" },
    affectedCount: 1,
    reason: "operator confirmed safe retry",
    correlationId: "corr-1",
  };
  const preview = service.preview({ allowed: true }, request);
  assert.equal(preview.policyDecision, "REQUIRE_REASON");
  assert.deepEqual(preview.safeguards, ["PREVIEW", "AUDIT", "CONFIRMATION", "REASON", "VERIFICATION"]);

  const rejected = await service.execute(request, preview, {
    actorId: "operator-1",
    requestContext: { requestId: "req-1", method: "POST", path: "/api/admin/jobs/job-1/retry" },
    previewPolicyVersion: OPERATIONS_POLICY_VERSION,
    evidence: { confirmed: false, reason: request.reason },
    executionId: "exec-1",
  });
  assert.equal(rejected.execution.result, "REJECTED");
  assert.equal(recovered, 0);

  const accepted = await service.execute(request, preview, {
    actorId: "operator-1",
    requestContext: { requestId: "req-2", method: "POST", path: "/api/admin/jobs/job-1/retry" },
    previewPolicyVersion: OPERATIONS_POLICY_VERSION,
    evidence: { confirmed: true, reason: request.reason },
    executionId: "exec-2",
  });
  assert.equal(accepted.execution.result, "SUCCESS");
  assert.equal(accepted.verification.status, "PASSED");
  assert.equal(recovered, 1);
  assert.equal(events.length, 2);
});

test("Production JOB_RETRY remains Human Gate and cannot execute directly", async () => {
  let recovered = 0;
  const handler = createJobRetryOperationHandler({
    environment: "production",
    job,
    adapter: {
      jobType: "example.recoverable",
      recover: async () => {
        recovered += 1;
        return { result: "SUCCESS" as const };
      },
    },
  });
  const service = new OperationsApplicationService(
    new OperationRegistry([handler]),
    { write: () => undefined },
  );
  const request = {
    definition: JOB_RETRY_OPERATION,
    actorKind: "HUMAN" as const,
    environment: "production" as const,
    target: { resourceType: "async_job", resourceId: job.jobId, scopeId: "scope-1" },
    affectedCount: 1,
    reason: "recovery",
    correlationId: "corr-2",
  };
  const preview = service.preview({ allowed: true }, request);
  assert.equal(preview.policyDecision, "HUMAN_GATE");

  const result = await service.execute(request, preview, {
    actorId: "operator-1",
    requestContext: { requestId: "req-3", method: "POST", path: "/api/admin/jobs/job-1/retry" },
    previewPolicyVersion: OPERATIONS_POLICY_VERSION,
    evidence: { confirmed: true, reason: request.reason, approvalId: "approval-1" },
    executionId: "exec-3",
  });
  assert.equal(result.execution.result, "REJECTED");
  assert.equal(recovered, 0);
});
