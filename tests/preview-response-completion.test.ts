import assert from "node:assert/strict";
import test from "node:test";
import {
  ensurePreviewLoginAuthenticated,
  PreviewLoginVerificationError,
} from "../e2e/preview/preview-response-completion";

const verified = { authenticated: true, user: { id: "workhub-demo-aoi" } };

test("browser-authenticated session for expected persona satisfies the gate", async () => {
  await ensurePreviewLoginAuthenticated({ check: async () => verified }, "workhub-demo-aoi", 50);
});

test("wrong authenticated persona does not pass Preview verification", async () => {
  await assert.rejects(
    () => ensurePreviewLoginAuthenticated({ check: async () => verified }, "workhub-demo-kai", 50),
    (error: unknown) => error instanceof PreviewLoginVerificationError && error.kind === "invalid_session",
  );
});

test("HTTP 200 without browser-authenticated session fails closed", async () => {
  await assert.rejects(
    () => ensurePreviewLoginAuthenticated({ check: async () => ({ authenticated: false }) }, "workhub-demo-aoi", 50),
    (error: unknown) => error instanceof PreviewLoginVerificationError && error.kind === "invalid_session",
  );
});

test("browser verification errors are sanitized", async () => {
  await assert.rejects(
    () => ensurePreviewLoginAuthenticated({
      check: async () => { throw new Error("secret data from browser state"); },
    }, "workhub-demo-aoi", 50),
    (error: unknown) => error instanceof PreviewLoginVerificationError
      && error.kind === "probe_failed" && !error.message.includes("secret data"),
  );
});

test("never-completing browser authentication verification times out", async () => {
  const start = Date.now();
  await assert.rejects(
    () => ensurePreviewLoginAuthenticated({
      check: () => new Promise<unknown>(() => {}),
    }, "workhub-demo-aoi", 15),
    (error: unknown) => error instanceof PreviewLoginVerificationError && error.kind === "timeout",
  );
  assert.ok(Date.now() - start < 1000);
});

test("invalid timeout and empty expected user are not allowed", async () => {
  await assert.rejects(() => ensurePreviewLoginAuthenticated({ check: async () => verified }, "workhub-demo-aoi", 0), RangeError);
  await assert.rejects(() => ensurePreviewLoginAuthenticated({ check: async () => verified }, "", 50), RangeError);
});
