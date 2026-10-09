import assert from "node:assert/strict";
import test from "node:test";
import {
  ensurePreviewLoginResponseComplete,
  PreviewLoginResponseIncompleteError,
} from "../e2e/preview/preview-response-completion";

const verified = { authenticated: true, user: { id: "demo" } };

test("real confirmed login JSON resolves before deadline", async () => {
  await ensurePreviewLoginResponseComplete({ json: async () => verified }, 50);
});

test("response-body read errors are sanitized transport failures", async () => {
  await assert.rejects(
    () => ensurePreviewLoginResponseComplete({
      json: async () => { throw new Error("secret data in transport failure"); },
    }, 50),
    (error: unknown) => error instanceof PreviewLoginResponseIncompleteError
      && error.kind === "transport" && !error.message.includes("secret data"),
  );
});

test("header-only HTTP 200 whose JSON never completes fails in bounded time", async () => {
  const start = Date.now();
  await assert.rejects(
    () => ensurePreviewLoginResponseComplete({
      json: () => new Promise<unknown>(() => {}),
    }, 15),
    (error: unknown) => error instanceof PreviewLoginResponseIncompleteError
      && error.kind === "timeout",
  );
  assert.ok(Date.now() - start < 1000);
});

test("HTTP 200 with invalid authentication payload fails closed", async () => {
  await assert.rejects(
    () => ensurePreviewLoginResponseComplete({
      json: async () => ({ authenticated: false, user: { id: "demo" } }),
    }, 50),
    (error: unknown) => error instanceof PreviewLoginResponseIncompleteError
      && error.kind === "invalid_payload",
  );
});

test("invalid timeout cannot silently disable completion gate", async () => {
  await assert.rejects(
    () => ensurePreviewLoginResponseComplete({ json: async () => verified }, 0),
    RangeError,
  );
});
