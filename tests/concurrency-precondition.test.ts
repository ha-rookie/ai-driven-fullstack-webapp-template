import assert from "node:assert/strict";
import test from "node:test";

import {
  formatVersionEtag,
  resolveConcurrencyPrecondition,
  stalePreconditionHttpMapping,
} from "../src/worker/http";

const request = (ifMatch?: string) =>
  new Request("https://example.test/api/resource", {
    headers: ifMatch ? { "if-match": ifMatch } : undefined,
  });

test("body expectedVersion remains a valid concurrency precondition", () => {
  const result = resolveConcurrencyPrecondition(request(), 3);

  assert.deepEqual(result, {
    ok: true,
    precondition: { expectedVersion: 3, source: "body" },
  });
});

test("If-Match can carry the version without a body expectedVersion", () => {
  const result = resolveConcurrencyPrecondition(request('"v4"'), undefined);

  assert.deepEqual(result, {
    ok: true,
    precondition: { expectedVersion: 4, source: "if-match" },
  });
});

test("matching If-Match and body expectedVersion are accepted together", () => {
  const result = resolveConcurrencyPrecondition(request('"v5"'), 5);

  assert.deepEqual(result, {
    ok: true,
    precondition: { expectedVersion: 5, source: "both" },
  });
});

test("conflicting If-Match and body expectedVersion fail closed", () => {
  const result = resolveConcurrencyPrecondition(request('"v5"'), 4);

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    code: "invalid_precondition",
    message: "Concurrency precondition is invalid",
    reason: "conflicting_versions",
  });
});

test("missing concurrency precondition returns 428", () => {
  const result = resolveConcurrencyPrecondition(request(), undefined);

  assert.deepEqual(result, {
    ok: false,
    status: 428,
    code: "precondition_required",
    message: "A concurrency precondition is required",
    reason: "missing",
  });
});

test("malformed, weak, wildcard, and multi-value If-Match forms are rejected by the reference contract", () => {
  for (const value of ["v2", 'W/"v2"', "*", '"v2", "v3"', '"v0"']) {
    const result = resolveConcurrencyPrecondition(request(value), undefined);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.code, "invalid_precondition");
      assert.equal(result.reason, "malformed_if_match");
    }
  }
});

test("invalid body expectedVersion is rejected separately from a missing precondition", () => {
  for (const value of [null, 0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) {
    const result = resolveConcurrencyPrecondition(request(), value);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.code, "invalid_precondition");
      assert.equal(result.reason, "invalid_body_version");
    }
  }
});

test("reference ETag format round-trips positive versions", () => {
  assert.equal(formatVersionEtag(1), '"v1"');
  assert.equal(formatVersionEtag(42), '"v42"');
  assert.throws(() => formatVersionEtag(0));
});

test("stale mapping preserves body compatibility and uses HTTP 412 for If-Match", () => {
  assert.deepEqual(
    stalePreconditionHttpMapping({ expectedVersion: 2, source: "body" }),
    {
      status: 409,
      code: "stale_update",
      message: "The resource changed after it was read",
    },
  );

  for (const source of ["if-match", "both"] as const) {
    assert.deepEqual(
      stalePreconditionHttpMapping({ expectedVersion: 2, source }),
      {
        status: 412,
        code: "precondition_failed",
        message: "The resource changed after it was read",
      },
    );
  }
});
