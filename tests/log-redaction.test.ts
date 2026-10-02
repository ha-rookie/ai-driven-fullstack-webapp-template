import assert from "node:assert/strict";
import test from "node:test";

import {
  LOG_REDACTION_LIMITS,
  REDACTED_LOG_VALUE,
  TRUNCATED_LOG_VALUE,
  StructuredApplicationLogger,
  isSensitiveLogKey,
  redactLogValue,
} from "../src/shared/logging";
import { createFixedClock } from "../src/shared/runtime";
import { ConsoleAuditLogger, writeAuditSafely } from "../src/worker/audit";

const jsonProjection = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(redactLogValue(value))) as unknown;

test("denylist normalizes key case/separators and covers secret and PII candidate keys", () => {
  for (const key of [
    "Authorization", "proxy-authorization", "COOKIE", "Set-Cookie",
    "refresh_token", "client.Secret", "password", "api_key", "privateKey",
    "session_id", "credential", "requestBody", "response_body",
    "e-mail", "phone_number", "shippingAddress", "ip_address", "userAgent",
  ]) {
    assert.equal(isSensitiveLogKey(key), true, key);
  }
  for (const key of ["requestId", "scopeId", "resourceId", "message", "timestamp"]) {
    assert.equal(isSensitiveLogKey(key), false, key);
  }
});

test("nested objects and arrays redact sensitive values without mutating source", () => {
  const secret = "sensitive-value-do-not-output"; // secret-scan: allow — deterministic redaction fixture
  const source = {
    requestId: "safe-request",
    nested: [
      { authorization: secret, safe: "allowed" },
      { contact: { email: secret, phoneNumber: secret }, "Set-Cookie": secret },
    ],
    metadata: { clientSecret: secret, api_key: secret },
  };
  const original = JSON.stringify(source);
  const projected = jsonProjection(source);
  assert.deepEqual(projected, {
    requestId: "safe-request",
    nested: [
      { authorization: REDACTED_LOG_VALUE, safe: "allowed" },
      {
        contact: { email: REDACTED_LOG_VALUE, phoneNumber: REDACTED_LOG_VALUE },
        "Set-Cookie": REDACTED_LOG_VALUE,
      },
    ],
    metadata: { clientSecret: REDACTED_LOG_VALUE, api_key: REDACTED_LOG_VALUE },
  });
  assert.equal(JSON.stringify(projected).includes(secret), false);
  assert.equal(JSON.stringify(source), original);
});

test("sensitive accessors and arbitrary toJSON methods are never called", () => {
  let invocations = 0;
  const source: Record<string, unknown> = {};
  Object.defineProperty(source, "token", {
    enumerable: true,
    get() { invocations += 1; throw new Error("secret getter"); },
  });
  Object.defineProperty(source, "safe", {
    enumerable: true,
    get() { invocations += 1; return "not-to-be-read"; },
  });
  Object.defineProperty(source, "toJSON", {
    enumerable: true,
    value: () => { invocations += 1; return { secret: "leaked" }; },
  });
  const result = jsonProjection(source);
  assert.deepEqual(result, {
    token: REDACTED_LOG_VALUE,
    safe: REDACTED_LOG_VALUE,
    toJSON: REDACTED_LOG_VALUE,
  });
  assert.equal(invocations, 0);
});

test("string/key lengths, collection size, depth, cycles and node count are bounded", () => {
  const cyclic: Record<string, unknown> = { safe: "present" };
  cyclic.self = cyclic;
  cyclic.notes = "x".repeat(1000);
  cyclic.rows = Array.from({ length: 40 }, (_, index) => index);
  cyclic.deep = { a: { b: { c: { d: { e: "not emitted" } } } } };
  cyclic["z".repeat(100)] = "oversized key not disclosed";
  const projected = jsonProjection(cyclic) as Record<string, unknown>;
  assert.equal(projected.self, TRUNCATED_LOG_VALUE);
  assert.equal((projected.notes as string).length, LOG_REDACTION_LIMITS.maxStringLength);
  const rows = projected.rows as unknown[];
  assert.equal(rows.length, LOG_REDACTION_LIMITS.maxCollectionEntries + 1);
  assert.equal(rows.at(-1), TRUNCATED_LOG_VALUE);
  assert.equal((projected.deep as { a: { b: { c: unknown } } }).a.b.c, TRUNCATED_LOG_VALUE);
  assert.equal(Object.keys(projected).some((key) => key.includes("oversized key")), false);
  assert.equal(Object.keys(projected).some((key) => key.startsWith("[TRUNCATED_KEY_")), true);
  assert.equal(cyclic.self, cyclic);
  assert.equal((cyclic.notes as string).length, 1000);

  const many = Array.from({ length: 20 }, () =>
    Array.from({ length: 20 }, () => ({ value: "safe" })));
  assert.equal(JSON.stringify(jsonProjection(many)).includes(TRUNCATED_LOG_VALUE), true);
});

test("unknown objects and unsupported values cannot bypass controlled projection", () => {
  const secret = "never-output-this-secret"; // secret-scan: allow — deterministic redaction fixture
  const value = {
    error: new Error(secret),
    date: new Date("2026-09-30T00:00:00.000Z"),
    unsupported: BigInt(10),
    invalid: Number.POSITIVE_INFINITY,
    safe: "ok",
  };
  const line = JSON.stringify(redactLogValue(value));
  assert.equal(line.includes(secret), false);
  assert.deepEqual(JSON.parse(line), {
    error: REDACTED_LOG_VALUE,
    date: REDACTED_LOG_VALUE,
    unsupported: REDACTED_LOG_VALUE,
    invalid: REDACTED_LOG_VALUE,
    safe: "ok",
  });
});

test("application logger uses shared redactor without relaxing context allowlist", () => {
  const lines: string[] = [];
  const logger = new StructuredApplicationLogger(
    "worker.http",
    (_level, line) => lines.push(line),
    createFixedClock("2026-09-30T00:00:00.000Z"),
  ).withContext({ requestId: "request-1", cookie: "secret" });
  logger.warn("x".repeat(1000), { scopeId: "scope-1", accessToken: "secret" });
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(record.kind, "application");
  assert.equal(record.requestId, "request-1");
  assert.equal(record.scopeId, "scope-1");
  assert.equal((record.message as string).length, LOG_REDACTION_LIMITS.maxStringLength);
  assert.equal(lines[0].includes("secret"), false);
  assert.equal(Object.hasOwn(record, "cookie"), false);
  assert.equal(Object.hasOwn(record, "accessToken"), false);
});

test("audit sink applies same limits while retaining its explicit field contract", () => {
  const lines: string[] = [];
  const logger = new ConsoleAuditLogger(
    (line) => lines.push(line),
    () => new Date("2026-09-30T00:00:00.000Z"),
  );
  logger.write({
    category: "authorization", action: "resource_update", outcome: "failure",
    requestId: "request-2", method: "PATCH", path: "/api/resources/1",
    reason: "r".repeat(1000),
    token: "should-not-be-serialized",
  } as Parameters<ConsoleAuditLogger["write"]>[0] & { token: string });
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(record.kind, "audit");
  assert.equal(record.requestId, "request-2");
  assert.equal((record.reason as string).length, LOG_REDACTION_LIMITS.maxStringLength);
  assert.equal(Object.hasOwn(record, "token"), false);
  assert.equal(lines[0].includes("should-not-be-serialized"), false);
});

test("redactor or sink failure cannot alter a successful business operation", () => {
  const malformed = new Proxy({}, {
    getPrototypeOf() { throw new Error("bad object"); },
  });
  assert.throws(() => redactLogValue(malformed));
  const logger = new StructuredApplicationLogger("worker.http", () => {
    throw new Error("sink failure");
  });
  assert.doesNotThrow(() => logger.info("status_ok"));
  assert.doesNotThrow(() => writeAuditSafely(new ConsoleAuditLogger(() => {
    throw new Error("sink failure");
  }), {
    category: "system", action: "status_check", outcome: "success",
    requestId: "request-3", method: "GET", path: "/api/health",
  }));
});
