import { strict as assert } from "node:assert";
import { test } from "node:test";

import { AppError, err, ok } from "../src/shared/errors";
import { NoopLogger } from "../src/shared/logging";
import {
  combineValidationResults,
  invalid,
  valid,
} from "../src/shared/validation";

test("AppError separates internal and user-facing messages", () => {
  const cause = new Error("root cause");
  const error = new AppError({
    code: "dependency_failed",
    message: "internal diagnostic detail",
    userMessage: "Please try again later.",
    retryable: true,
    cause,
  });

  assert.equal(error.name, "AppError");
  assert.equal(error.code, "dependency_failed");
  assert.equal(error.message, "internal diagnostic detail");
  assert.equal(error.userMessage, "Please try again later.");
  assert.equal(error.retryable, true);
  assert.equal(error.cause, cause);
});

test("AppError defaults retryable to false", () => {
  const error = new AppError({
    code: "invalid_state",
    message: "The state transition is invalid.",
  });

  assert.equal(error.retryable, false);
});

test("Result represents success and failure without exceptions", () => {
  const success = ok(42);
  const failureError = new AppError({
    code: "not_found",
    message: "Resource was not found.",
  });
  const failure = err(failureError);

  assert.equal(success.ok, true);
  if (success.ok) {
    assert.equal(success.value, 42);
  }

  assert.equal(failure.ok, false);
  if (!failure.ok) {
    assert.equal(failure.error, failureError);
  }
});

test("ValidationResult combines issues while preserving valid results", () => {
  const required = invalid({
    code: "required",
    path: "name",
    message: "Name is required.",
  });
  const tooLong = invalid({
    code: "too_long",
    path: "description",
    message: "Description is too long.",
  });

  const combined = combineValidationResults(valid(), required, tooLong);

  assert.equal(combined.valid, false);
  assert.deepEqual(combined.issues, [
    {
      code: "required",
      path: "name",
      message: "Name is required.",
    },
    {
      code: "too_long",
      path: "description",
      message: "Description is too long.",
    },
  ]);

  assert.deepEqual(combineValidationResults(valid(), valid()), valid());
});

test("NoopLogger satisfies the logging contract without side effects", () => {
  const logger = new NoopLogger();
  const context = { requestId: "request-1", attempt: 1 };

  assert.doesNotThrow(() => {
    logger.debug("debug", context);
    logger.info("info", context);
    logger.warn("warn", context);
    logger.error("error", context);
  });
});
