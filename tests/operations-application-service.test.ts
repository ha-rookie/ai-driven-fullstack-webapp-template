import assert from "node:assert/strict";
import test from "node:test";

import type { AuditEvent, AuditLogger } from "../src/worker/audit";
import {
  DuplicateOperationRegistrationError,
  OPERATIONS_POLICY_VERSION,
  OperationRegistry,
  OperationsApplicationService,
  type OperationDefinition,
  type OperationHandler,
  type OperationRequest,
} from "../src/worker/operations";

const definition: OperationDefinition = {
  id: "job.retry",
  capability: "jobs:operate",
  baseRisk: "OPERATIONAL",
  reversible: false,
  idempotent: true,
  externalSideEffect: false,
  requiresVerification: true,
};

const request: OperationRequest = {
  definition,
  actorKind: "HUMAN",
  environment: "test",
  target: { resourceType: "job", resourceId: "job-1", scopeId: "ops" },
  affectedCount: 1,
  correlationId: "corr-1",
};

class MemoryAuditLogger implements AuditLogger {
  readonly events: AuditEvent[] = [];
  write(event: AuditEvent): void { this.events.push(event); }
}

const context = {
  actorId: "actor-1",
  requestContext: { requestId: "req-1", method: "POST", path: "/operations" },
  previewPolicyVersion: OPERATIONS_POLICY_VERSION,
  evidence: { confirmed: true },
  executionId: "exec-1",
};

test("registry rejects duplicate operation ids", () => {
  const handler: OperationHandler = {
    definition,
    async execute() { return { result: "SUCCESS" }; },
  };
  assert.throws(
    () => new OperationRegistry([handler, handler]),
    DuplicateOperationRegistrationError,
  );
});

test("shared service orchestrates preview execute verify and audit", async () => {
  const audit = new MemoryAuditLogger();
  const handler: OperationHandler = {
    definition,
    async execute() { return { result: "SUCCESS" }; },
    async verify() { return { status: "PASSED", summary: "job accepted" }; },
  };
  const service = new OperationsApplicationService(new OperationRegistry([handler]), audit);
  const preview = service.preview({ allowed: true }, request);
  const result = await service.execute(request, preview, context);

  assert.equal(result.execution.result, "SUCCESS");
  assert.equal(result.execution.correlationId, "corr-1");
  assert.equal(result.execution.policyVersion, OPERATIONS_POLICY_VERSION);
  assert.equal(result.verification.status, "PASSED");
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0]?.action, "operation.job.retry");
});

test("preview mismatch becomes conflict without invoking handler", async () => {
  let called = false;
  const audit = new MemoryAuditLogger();
  const handler: OperationHandler = {
    definition,
    async execute() { called = true; return { result: "SUCCESS" }; },
  };
  const service = new OperationsApplicationService(new OperationRegistry([handler]), audit);
  const preview = service.preview({ allowed: true }, request);
  const result = await service.execute(
    { ...request, target: { ...request.target, resourceId: "job-2" } },
    preview,
    context,
  );
  assert.equal(result.execution.result, "CONFLICT");
  assert.equal(called, false);
});

test("handler exception normalizes to UNKNOWN and verifier exception to UNKNOWN", async () => {
  const audit = new MemoryAuditLogger();
  const handler: OperationHandler = {
    definition,
    async execute() { throw new Error("provider unavailable"); },
    async verify() { throw new Error("verification unavailable"); },
  };
  const service = new OperationsApplicationService(new OperationRegistry([handler]), audit);
  const preview = service.preview({ allowed: true }, request);
  const result = await service.execute(request, preview, context);
  assert.equal(result.execution.result, "UNKNOWN");
  assert.equal(result.verification.status, "UNKNOWN");
});

test("partial and conflict results are preserved", async () => {
  for (const executionResult of ["PARTIAL", "CONFLICT"] as const) {
    const audit = new MemoryAuditLogger();
    const handler: OperationHandler = {
      definition: { ...definition, requiresVerification: false },
      async execute() { return { result: executionResult }; },
    };
    const req = { ...request, definition: handler.definition };
    const service = new OperationsApplicationService(new OperationRegistry([handler]), audit);
    const preview = service.preview({ allowed: true }, req);
    const result = await service.execute(req, preview, context);
    assert.equal(result.execution.result, executionResult);
  }
});

test("guard rejection prevents handler execution for all actor kinds", async () => {
  for (const actorKind of ["HUMAN", "SERVICE", "AI_AGENT"] as const) {
    let called = false;
    const audit = new MemoryAuditLogger();
    const handler: OperationHandler = {
      definition,
      async execute() { called = true; return { result: "SUCCESS" }; },
    };
    const req = { ...request, actorKind };
    const service = new OperationsApplicationService(new OperationRegistry([handler]), audit);
    const preview = service.preview({ allowed: false, reason: "forbidden" }, req);
    const result = await service.execute(req, preview, { ...context, evidence: {} });
    assert.equal(result.execution.result, "REJECTED");
    assert.equal(called, false);
  }
});

test("#430 Golden #6: privileged operation is rejected before side effects if admission audit fails", async () => {
  let executed = 0;
  const handler: OperationHandler = {
    definition,
    async execute() { executed += 1; return { result: "SUCCESS" }; },
  };
  const audit: AuditLogger = {
    write() { throw new Error("audit unavailable"); },
  };
  const service = new OperationsApplicationService(new OperationRegistry([handler]), audit);
  const privilegedRequest = { ...request, affectedCount: 101 };
  const preview = service.preview({ allowed: true }, privilegedRequest);
  assert.equal(preview.risk, "PRIVILEGED");
  const result = await service.execute(privilegedRequest, preview, {
    ...context,
    evidence: { confirmed: true, reason: "approved manual recovery", stepUpVerified: true },
  });

  assert.equal(result.execution.result, "REJECTED");
  assert.equal(result.verification.status, "NOT_APPLICABLE");
  assert.equal(executed, 0);
});

test("#430 privileged admission and outcome audits are distinct, with metadata-only projections", async () => {
  const audit = new MemoryAuditLogger();
  const handler: OperationHandler = {
    definition,
    async execute() { return { result: "SUCCESS" }; },
  };
  const service = new OperationsApplicationService(new OperationRegistry([handler]), audit);
  const privilegedRequest = { ...request, affectedCount: 101 };
  const preview = service.preview({ allowed: true }, privilegedRequest);
  const result = await service.execute(privilegedRequest, preview, {
    ...context,
    evidence: { confirmed: true, reason: "manual review", stepUpVerified: true },
  });

  assert.equal(result.execution.result, "SUCCESS");
  assert.deepEqual(audit.events.map((event) => event.action), [
    "operation.job.retry.admitted",
    "operation.job.retry",
  ]);
  assert.equal(audit.events[0]?.requestId, "req-1");
  assert.equal(audit.events[1]?.requestId, "req-1");
  assert.equal(JSON.stringify(audit.events).includes("manual review"), false);
});

test("#430 failure after side effect is UNKNOWN, never safe-to-retry REJECTED", async () => {
  let executed = 0;
  let auditWrites = 0;
  const audit: AuditLogger = {
    write() {
      auditWrites += 1;
      if (auditWrites === 2) throw new Error("audit unavailable after execution");
    },
  };
  const handler: OperationHandler = {
    definition,
    async execute() { executed += 1; return { result: "SUCCESS" }; },
    async verify() { return { status: "PASSED" }; },
  };
  const service = new OperationsApplicationService(new OperationRegistry([handler]), audit);
  const privilegedRequest = { ...request, affectedCount: 101 };
  const preview = service.preview({ allowed: true }, privilegedRequest);
  const result = await service.execute(privilegedRequest, preview, {
    ...context,
    evidence: { confirmed: true, reason: "manual review", stepUpVerified: true },
  });

  assert.equal(result.execution.result, "UNKNOWN");
  assert.equal(result.verification.status, "UNKNOWN");
  assert.equal(executed, 1);
  assert.equal(auditWrites, 2);
});
