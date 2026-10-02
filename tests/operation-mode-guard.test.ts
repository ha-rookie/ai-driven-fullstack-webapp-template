import assert from "node:assert/strict";
import test from "node:test";
import { type OperationMode, type OperationModeState, type OperationModeStore } from "../src/domain/operation-mode";
import { OperationModeGuard, isMutationMethod, operationModeRejectionAuditFields, operationModeRejectionResponse } from "../src/worker/http";

const state = (mode: OperationMode): OperationModeState => ({
  environment: "preview", mode, version: 1, updatedAt: "2026-10-02T10:00:00.000Z",
  updatedBy: "operator-private", reason: "Private operational reason",
});
const store = (read: () => Promise<OperationModeState>): OperationModeStore => ({
  read, update: async () => { throw new Error("Guard must not update mode"); },
});
const options = { environment: "preview" as const, retryAfterSeconds: 30 };
const request = (method: string) => new Request("https://example.test/api/resource", { method });

test("normal allows requests; read-only denies mutations; maintenance denies every method", async () => {
  for (const mode of ["normal", "read-only", "maintenance"] as const) {
    const guard = new OperationModeGuard(store(async () => state(mode)), options);
    for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PATCH", "PUT", "DELETE", "CUSTOM"]) {
      const decision = await guard.check(request(method));
      assert.equal(decision.allowed, mode === "normal" || (mode === "read-only" && !isMutationMethod(method)), `${mode}:${method}`);
      if (!decision.allowed) assert.equal(decision.reason, mode === "maintenance" ? "maintenance" : "read_only");
    }
  }
});

test("state is re-read on every check, with no stale normal cache", async () => {
  let current: OperationMode = "normal";
  let calls = 0;
  const guard = new OperationModeGuard(store(async () => { calls++; return state(current); }), options);
  assert.equal((await guard.check(request("POST"))).allowed, true);
  current = "maintenance";
  assert.equal((await guard.check(request("POST"))).allowed, false);
  assert.equal(calls, 2);
});

test("unknown state, environment mismatch and dependency failure reject without normal fallback", async () => {
  for (const read of [
    async () => { throw new Error("sensitive SQL diagnostics"); },
    async () => ({ ...state("normal"), environment: "production" as const }),
    async () => ({ ...state("normal"), mode: "other" as OperationMode }),
    async () => ({ ...state("normal"), version: 0 }),
  ]) {
    assert.deepEqual(await new OperationModeGuard(store(read), options).check(request("GET")),
      { allowed: false, reason: "unavailable", retryAfterSeconds: 30 });
  }
});

test("HTTP boundary stops handlers after rejection and returns the standard envelope", async () => {
  let writes = 0;
  const guard = new OperationModeGuard(store(async () => state("read-only")), options);
  const handler = async (req: Request) => {
    const decision = await guard.check(req);
    if (!decision.allowed) return operationModeRejectionResponse(decision, "request-78");
    writes++;
    return new Response(null, { status: 204 });
  };
  const response = await handler(request("POST"));
  assert.equal(writes, 0);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(response.headers.get("x-request-id"), "request-78");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: { code: "operation_read_only", message: "Updates are temporarily unavailable" }, requestId: "request-78" });
  assert.equal((await handler(request("GET"))).status, 204);
  assert.equal(writes, 1);
});

test("maintenance and unavailable map to distinct stable codes without exposing metadata", async () => {
  for (const reason of ["maintenance", "unavailable"] as const) {
    const response = operationModeRejectionResponse({ allowed: false, reason, retryAfterSeconds: 7 }, "request-78");
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(body.includes(reason === "maintenance" ? "service_in_maintenance" : "operation_mode_unavailable"));
    assert.equal(body.includes("operator-private"), false);
  }
});

test("Audit projection contains only fixed rejection context", () => {
  assert.deepEqual(operationModeRejectionAuditFields({ allowed: false, reason: "maintenance", retryAfterSeconds: 7 }), {
    category: "system", action: "operation_mode_guard", outcome: "failure", resourceType: "operation_mode", reason: "maintenance",
  });
});

test("Project must provide a valid environment and retry hint", () => {
  for (const retryAfterSeconds of [0, -1, 1.5, Infinity]) {
    assert.throws(() => new OperationModeGuard(store(async () => state("normal")), { ...options, retryAfterSeconds }), TypeError);
  }
  assert.throws(() => new OperationModeGuard(store(async () => state("normal")), { ...options, environment: "other" as "preview" }));
});
