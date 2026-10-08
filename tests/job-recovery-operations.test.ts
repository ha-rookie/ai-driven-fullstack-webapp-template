import assert from "node:assert/strict";
import test from "node:test";

import {
  JOB_RETRY_OPERATION,
  JobRecoveryRegistry,
  createD1RequeueJobRecoveryAdapter,
  createJobRetryOperationHandler,
  type RecoverableJobRecord,
} from "../src/worker/administration";
import { createAsyncJobEnvelope } from "../src/shared/async-job";
import {
  OperationRegistry,
  OperationsApplicationService,
  OPERATIONS_POLICY_VERSION,
} from "../src/worker/operations";

const job: RecoverableJobRecord = {
  jobId: "job-1",
  type: "example.recoverable",
  idempotencyKey: "job-1",
  payloadFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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


test("D1 requeue recovery only republishes an envelope with the original identity and fingerprint", async () => {
  const envelope = await createAsyncJobEnvelope({
    type: "example.recoverable",
    payload: { resourceId: "resource-1" },
    jobId: "job-safe-1",
    idempotencyKey: "job-safe-1",
  });
  const terminal: RecoverableJobRecord = {
    jobId: envelope.jobId,
    type: envelope.type,
    idempotencyKey: envelope.idempotencyKey,
    payloadFingerprint: envelope.payloadFingerprint,
    state: "dead_letter",
    attempt: 4,
    updatedAt: "2026-10-08T00:00:00.000Z",
    failureCode: "temporary_failure",
  };
  const binds: unknown[][] = [];
  const db = {
    prepare() {
      return {
        bind(...values: unknown[]) {
          binds.push(values);
          return { run: async () => ({ meta: { changes: 1 } }) };
        },
      };
    },
  } as unknown as D1Database;
  const published: unknown[] = [];
  const adapter = createD1RequeueJobRecoveryAdapter({
    jobType: "example.recoverable",
    db,
    publisher: { publish: async (message) => { published.push(message); } },
    rebuildEnvelope: async () => envelope,
    clock: { now: () => new Date("2026-10-08T01:00:00.000Z") },
  });

  const result = await adapter.recover({
    environment: "preview",
    job: terminal,
    reason: "manual recovery after dependency restoration",
  });

  assert.equal(result.result, "SUCCESS");
  assert.equal(published.length, 1);
  assert.equal(binds.length, 1);
  assert.equal(binds[0][2], "preview");
  assert.equal(binds[0][3], terminal.jobId);
  assert.equal(binds[0][5], terminal.payloadFingerprint);
  assert.equal(binds[0][6], terminal.updatedAt);
});

test("D1 requeue recovery fails closed on rebuilt payload mismatch", async () => {
  const original = await createAsyncJobEnvelope({
    type: "example.recoverable",
    payload: { resourceId: "resource-1" },
    jobId: "job-safe-2",
    idempotencyKey: "job-safe-2",
  });
  const mismatched = await createAsyncJobEnvelope({
    type: "example.recoverable",
    payload: { resourceId: "different-resource" },
    jobId: original.jobId,
    idempotencyKey: original.idempotencyKey,
  });
  let writes = 0;
  let publishes = 0;
  const adapter = createD1RequeueJobRecoveryAdapter({
    jobType: "example.recoverable",
    db: {
      prepare() {
        return {
          bind() {
            return { run: async () => { writes += 1; return { meta: { changes: 1 } }; } };
          },
        };
      },
    } as unknown as D1Database,
    publisher: { publish: async () => { publishes += 1; } },
    rebuildEnvelope: async () => mismatched,
  });

  const result = await adapter.recover({
    environment: "preview",
    job: {
      jobId: original.jobId,
      type: original.type,
      idempotencyKey: original.idempotencyKey,
      payloadFingerprint: original.payloadFingerprint,
      state: "failed",
      attempt: 2,
      updatedAt: "2026-10-08T00:00:00.000Z",
    },
    reason: "retry",
  });

  assert.equal(result.result, "CONFLICT");
  assert.equal(writes, 0);
  assert.equal(publishes, 0);
});

test("D1 requeue recovery reports PARTIAL when durable reopen succeeds but publish outcome fails", async () => {
  const envelope = await createAsyncJobEnvelope({
    type: "example.recoverable",
    payload: { resourceId: "resource-3" },
    jobId: "job-safe-3",
    idempotencyKey: "job-safe-3",
  });
  const adapter = createD1RequeueJobRecoveryAdapter({
    jobType: envelope.type,
    db: {
      prepare() {
        return {
          bind() {
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    } as unknown as D1Database,
    publisher: { publish: async () => { throw new Error("queue unavailable"); } },
    rebuildEnvelope: async () => envelope,
  });

  const result = await adapter.recover({
    environment: "preview",
    job: {
      jobId: envelope.jobId,
      type: envelope.type,
      idempotencyKey: envelope.idempotencyKey,
      payloadFingerprint: envelope.payloadFingerprint,
      state: "failed",
      attempt: 1,
      updatedAt: "2026-10-08T00:00:00.000Z",
    },
    reason: "retry",
  });

  assert.equal(result.result, "PARTIAL");
});
