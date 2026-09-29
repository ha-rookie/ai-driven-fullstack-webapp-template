import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../src/shared/errors";
import type { ValidationIssue } from "../src/shared/validation";
import {
  apiErrorResponse,
  appErrorResponse,
  mapApiError,
  validationErrorResponse,
} from "../src/worker/http";

const readBody = async (response: Response) =>
  (await response.json()) as Record<string, unknown>;

const requestId = "req-test-123";

test("representative client error statuses use the standard envelope", async () => {
  const cases = [
    [400, "bad_request"],
    [401, "authentication_required"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [412, "precondition_failed"],
    [428, "precondition_required"],
    [429, "rate_limited"],
  ] as const;

  for (const [status, code] of cases) {
    const response = apiErrorResponse(
      { status, code, message: `public-${status}` },
      requestId,
    );

    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-request-id"), requestId);
    assert.deepEqual(await readBody(response), {
      error: { code, message: `public-${status}` },
      requestId,
    });
  }
});

test("validation issues map to 422 without losing bounded field context", async () => {
  const issues: readonly ValidationIssue[] = [
    { code: "required", path: "name", message: "name is required" },
    { code: "invalid_format", path: "email", message: "email is invalid" },
  ];

  const response = validationErrorResponse(issues, requestId);

  assert.equal(response.status, 422);
  assert.deepEqual(await readBody(response), {
    error: {
      code: "validation_failed",
      message: "Validation failed",
      issues,
    },
    requestId,
  });
});

test("AppError uses centralized status mapping and only exposes a public message", async () => {
  const error = new AppError({
    code: "resource_not_found",
    message: "SELECT failed with internal table details",
    userMessage: "Resource not found",
  });

  const response = appErrorResponse(error, requestId);
  const body = await readBody(response);

  assert.equal(response.status, 404);
  assert.deepEqual(body, {
    error: {
      code: "resource_not_found",
      message: "Resource not found",
    },
    requestId,
  });
  assert.doesNotMatch(JSON.stringify(body), /SELECT failed/);
});

test("precondition AppErrors use centralized 412 and 428 mappings", async () => {
  const failed = appErrorResponse(
    new AppError({
      code: "precondition_failed",
      message: "internal version detail",
      userMessage: "The resource changed after it was read",
    }),
    requestId,
  );
  const required = appErrorResponse(
    new AppError({
      code: "precondition_required",
      message: "internal request detail",
      userMessage: "A concurrency precondition is required",
    }),
    requestId,
  );

  assert.equal(failed.status, 412);
  assert.equal(required.status, 428);
  assert.match(JSON.stringify(await readBody(failed)), /resource changed/);
  assert.match(JSON.stringify(await readBody(required)), /precondition is required/);
});

test("server-side AppError does not expose internal message even when userMessage exists", async () => {
  const error = new AppError({
    code: "authentication_unavailable",
    message: "D1 prepare failed: internal detail",
    userMessage: "Please retry later",
  });

  const response = appErrorResponse(error, requestId);
  const serialized = JSON.stringify(await readBody(response));

  assert.equal(response.status, 503);
  assert.match(serialized, /Service unavailable/);
  assert.doesNotMatch(serialized, /D1 prepare failed/);
  assert.doesNotMatch(serialized, /Please retry later/);
});

test("unknown errors fail safe to generic 500 without leaking message or stack", async () => {
  const error = new Error("secret database failure detail");
  const response = mapApiError(error, requestId);
  const serialized = JSON.stringify(await readBody(response));

  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(serialized), {
    error: {
      code: "internal_error",
      message: "Internal server error",
    },
    requestId,
  });
  assert.doesNotMatch(serialized, /secret database failure detail/);
  assert.doesNotMatch(serialized, /stack/i);
});

test("endpoint-safe extra context is preserved without overriding the envelope", async () => {
  const response = apiErrorResponse(
    {
      status: 409,
      code: "stale_update",
      message: "The resource changed after it was read",
      extra: {
        current: { version: 4, status: "active" },
        requestId: "attempted-overwrite",
        error: { code: "attempted-overwrite" },
      },
    },
    requestId,
  );

  assert.deepEqual(await readBody(response), {
    current: { version: 4, status: "active" },
    error: {
      code: "stale_update",
      message: "The resource changed after it was read",
    },
    requestId,
  });
});
