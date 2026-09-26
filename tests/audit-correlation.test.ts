import assert from "node:assert/strict";
import test from "node:test";

import {
  ConsoleAuditLogger,
  REQUEST_ID_MAX_LENGTH,
  attachRequestId,
  createRequestContext,
  resolveRequestId,
  writeAuditSafely,
  type AuditEvent,
  type AuditLogger,
} from "../src/worker/audit";

test("CF-Ray is preferred over x-request-id", () => {
  const request = new Request("https://example.test/api/items?secret=ignored", {
    headers: {
      "cf-ray": "abc123-SIN",
      "x-request-id": "client-request-1",
    },
  });

  assert.equal(resolveRequestId(request, () => "generated"), "abc123-SIN");
  assert.deepEqual(createRequestContext(request, () => "generated"), {
    requestId: "abc123-SIN",
    method: "GET",
    path: "/api/items",
  });
});

test("a safe x-request-id is accepted when CF-Ray is absent", () => {
  const request = new Request("https://example.test/api/items", {
    headers: { "x-request-id": "request-1234_test.value:part" },
  });

  assert.equal(
    resolveRequestId(request, () => "generated"),
    "request-1234_test.value:part",
  );
});

test("malformed or oversized client request IDs fall back to generated IDs", () => {
  const malformed = new Request("https://example.test/api/items", {
    headers: { "x-request-id": "unsafe request id" },
  });
  const oversized = new Request("https://example.test/api/items", {
    headers: { "x-request-id": "a".repeat(REQUEST_ID_MAX_LENGTH + 1) },
  });

  assert.equal(resolveRequestId(malformed, () => "generated-a"), "generated-a");
  assert.equal(resolveRequestId(oversized, () => "generated-b"), "generated-b");
});

test("attachRequestId preserves the response while adding correlation header", async () => {
  const original = new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });

  const response = attachRequestId(original, "request-42");

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("x-request-id"), "request-42");
  assert.deepEqual(await response.json(), { ok: true });
});

test("ConsoleAuditLogger emits a bounded structured JSON record", () => {
  const lines: string[] = [];
  const logger = new ConsoleAuditLogger(
    (line) => lines.push(line),
    () => new Date("2026-09-26T00:00:00.000Z"),
  );

  const event = {
    category: "authorization",
    action: "resource_update",
    outcome: "failure",
    requestId: "request-1",
    method: "PATCH",
    path: "/api/resources/resource-1",
    actorId: "user-1",
    scopeId: "scope-1",
    resourceType: "example_resource",
    resourceId: "resource-1",
    reason: "role_required",
    token: "must-not-be-serialized",
    cookie: "must-not-be-serialized",
    requestBody: "must-not-be-serialized",
  } as AuditEvent & Record<string, unknown>;

  logger.write(event);

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(record, "token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record, "cookie"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record, "requestBody"), false);
  assert.deepEqual(record, {
    kind: "audit",
    timestamp: "2026-09-26T00:00:00.000Z",
    category: "authorization",
    action: "resource_update",
    outcome: "failure",
    requestId: "request-1",
    method: "PATCH",
    path: "/api/resources/resource-1",
    actorId: "user-1",
    scopeId: "scope-1",
    resourceType: "example_resource",
    resourceId: "resource-1",
    reason: "role_required",
  });
});

test("the same audit contract represents authentication and mutation outcomes", () => {
  const lines: string[] = [];
  const logger = new ConsoleAuditLogger(
    (line) => lines.push(line),
    () => new Date("2026-09-26T00:00:00.000Z"),
  );

  logger.write({
    category: "authentication",
    action: "session_resolve",
    outcome: "failure",
    requestId: "request-auth",
    method: "GET",
    path: "/api/auth/me",
    reason: "session_missing_or_invalid",
  });
  logger.write({
    category: "mutation",
    action: "resource_update",
    outcome: "failure",
    requestId: "request-mutation",
    method: "PATCH",
    path: "/api/resources/resource-1",
    resourceType: "example_resource",
    resourceId: "resource-1",
    reason: "stale_version",
  });

  assert.equal(JSON.parse(lines[0]).category, "authentication");
  assert.equal(JSON.parse(lines[1]).category, "mutation");
});

test("audit sink failure never escapes into core request handling", () => {
  const failingLogger: AuditLogger = {
    write() {
      throw new Error("log sink unavailable");
    },
  };

  assert.doesNotThrow(() =>
    writeAuditSafely(failingLogger, {
      category: "system",
      action: "security_sensitive_operation",
      outcome: "failure",
      requestId: "request-1",
      method: "POST",
      path: "/api/example",
      reason: "audit_sink_test",
    }),
  );
});
