import assert from "node:assert/strict";
import test from "node:test";

import { createFixedClock } from "../src/shared/runtime";
import {
  StructuredApplicationLogger,
  consoleApplicationLogSink,
  type ApplicationLogLevel,
} from "../src/shared/logging";

const fixedClock = createFixedClock("2026-09-30T00:00:00.000Z");

const captured = () => {
  const lines: Array<{ level: ApplicationLogLevel; line: string }> = [];
  const logger = new StructuredApplicationLogger(
    "worker.http",
    (level, line) => lines.push({ level, line }),
    fixedClock,
  );
  return { logger, lines };
};

test("four levels use a one-line JSON application contract, not the audit contract", () => {
  const { logger, lines } = captured();
  logger.debug("debug_event");
  logger.info("info_event");
  logger.warn("warn_event");
  logger.error("error_event");

  assert.deepEqual(lines.map((item) => item.level), ["debug", "info", "warn", "error"]);
  for (const { level, line } of lines) {
    assert.equal(line.includes("\n"), false);
    assert.deepEqual(JSON.parse(line), {
      kind: "application",
      timestamp: "2026-09-30T00:00:00.000Z",
      level,
      component: "worker.http",
      message: `${level}_event`,
    });
    assert.equal(Object.hasOwn(JSON.parse(line), "category"), false);
    assert.equal(Object.hasOwn(JSON.parse(line), "outcome"), false);
  }
});

test("request-scoped context is inherited, overridable and does not leak to other requests", () => {
  const { logger, lines } = captured();
  const first = logger.withContext({ requestId: "request-1", actorId: "user-1" });
  const second = logger.withContext({ requestId: "request-2" });
  first.info("request_event", { scopeId: "scope-1", actorId: "user-2" });
  second.info("request_event");
  logger.info("global_event");

  const [firstRecord, secondRecord, rootRecord] = lines.map(
    ({ line }) => JSON.parse(line) as Record<string, unknown>,
  );
  assert.deepEqual(
    [firstRecord.requestId, firstRecord.actorId, firstRecord.scopeId],
    ["request-1", "user-2", "scope-1"],
  );
  assert.equal(secondRecord.requestId, "request-2");
  assert.equal(Object.hasOwn(secondRecord, "actorId"), false);
  assert.equal(Object.hasOwn(rootRecord, "requestId"), false);
});

test("caller-supplied secrets and arbitrary nested values are never serialized", () => {
  const { logger, lines } = captured();
  const secret = "highly-sensitive-credential"; // secret-scan: allow — deterministic redaction fixture
  logger.withContext({
    requestId: "request-safe",
    token: secret,
    cookie: secret,
  }).info("safe_event", {
    requestId: "unsafe id containing spaces",
    actorId: 500,
    scopeId: "scope-safe",
    authorization: secret,
    requestBody: { password: secret },
    arbitrary: { nested: { apiKey: secret } },
  });

  assert.equal(lines[0].line.includes(secret), false);
  assert.deepEqual(JSON.parse(lines[0].line), {
    kind: "application",
    timestamp: "2026-09-30T00:00:00.000Z",
    level: "info",
    component: "worker.http",
    message: "safe_event",
    requestId: "request-safe",
    scopeId: "scope-safe",
  });
});

test("Error serialization includes standard type but omits message, stack and cause", () => {
  const { logger, lines } = captured();
  const secret = "super-secret-from-dependency"; // secret-scan: allow — deterministic redaction fixture
  const failure = new TypeError(secret, { cause: new Error(secret) });
  failure.stack = secret;
  logger.error("dependency_failed", { error: failure, cookie: secret });
  const record = JSON.parse(lines[0].line);
  assert.deepEqual(record.error, { name: "TypeError" });
  assert.equal(lines[0].line.includes(secret), false);

  const custom = new Error(secret);
  custom.name = secret;
  logger.error("unexpected_failure", { error: custom });
  assert.deepEqual(JSON.parse(lines[1].line).error, { name: "Error" });
  logger.error("non_error_throwable", { error: { message: secret } });
  assert.equal(Object.hasOwn(JSON.parse(lines[2].line), "error"), false);
});

test("sink failures, malformed context and invalid clock cannot break business handling", () => {
  const logger = new StructuredApplicationLogger("worker.http", () => {
    throw new Error("sink failure");
  }, fixedClock);
  assert.doesNotThrow(() => logger.warn("sink_failed"));

  const malformed = Object.defineProperty({}, "requestId", {
    enumerable: true,
    get() { throw new Error("malformed getter"); },
  });
  assert.doesNotThrow(() => logger.withContext(malformed).info("malformed_context"));

  const badClock = new StructuredApplicationLogger("worker.http", () => {
    throw new Error("should never write");
  }, { now: () => new Date(NaN) });
  assert.doesNotThrow(() => badClock.info("clock_failed"));
});

test("console sink dispatches one JSON line to matching console level", () => {
  const originalWarn = console.warn;
  const output: string[] = [];
  console.warn = (line) => { output.push(line); };
  try {
    consoleApplicationLogSink("warn", '{"kind":"application"}');
    assert.deepEqual(output, ['{"kind":"application"}']);
  } finally {
    console.warn = originalWarn;
  }
});
