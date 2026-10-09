import assert from "node:assert/strict";
import test from "node:test";
import {
  ensurePreviewLoginResponseComplete,
  PreviewLoginResponseIncompleteError,
} from "../e2e/preview/preview-response-completion";

test("complete login response resolves before deadline", async () => {
  await ensurePreviewLoginResponseComplete({ finished: async () => null }, 50);
});

test("broken login response is a transport failure, never a passing acceptance", async () => {
  await assert.rejects(
    () => ensurePreviewLoginResponseComplete({
      finished: async () => new Error("connection reset / private upstream diagnostics"),
    }, 50),
    (error: unknown) => error instanceof PreviewLoginResponseIncompleteError
      && error.kind === "transport" && !error.message.includes("private upstream diagnostics"),
  );
});

test("header-only HTTP 200 that never completes the body fails within bounded time", async () => {
  const start = Date.now();
  await assert.rejects(
    () => ensurePreviewLoginResponseComplete({
      finished: () => new Promise<Error | null>(() => {}),
    }, 15),
    (error: unknown) => error instanceof PreviewLoginResponseIncompleteError
      && error.kind === "timeout",
  );
  assert.ok(Date.now() - start < 1000);
});

test("invalid timeout cannot silently disable response completion gate", async () => {
  await assert.rejects(
    () => ensurePreviewLoginResponseComplete({ finished: async () => null }, 0),
    RangeError,
  );
});
