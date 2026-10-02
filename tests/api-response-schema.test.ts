import assert from "node:assert/strict";
import test from "node:test";

import {
  createApiSuccessEnvelope,
  decodeApiErrorEnvelope,
  decodeApiResponseMeta,
  decodeApiSuccessEnvelope,
} from "../src/shared/api";
import { apiErrorResponse, validationErrorResponse } from "../src/worker/http/api-error";

const requestId = "request-123";
const exampleDtoDecoder = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.displayName === "string"
    ? { id: record.id, displayName: record.displayName }
    : null;
};

test("shared success envelope decodes DTO, pagination and concurrency metadata at runtime", () => {
  const decoded = decodeApiSuccessEnvelope({
    data: { id: "resource-1", displayName: "Example", ignoredInternal: "not projected" },
    requestId,
    meta: {
      pagination: { nextCursor: "cursor-2", limit: 50, hasMore: true },
      concurrency: { version: 7, etag: "\"v7\"" },
      extensions: { source: "reference" },
    },
  }, exampleDtoDecoder);

  assert.deepEqual(decoded, {
    data: { id: "resource-1", displayName: "Example" },
    requestId,
    meta: {
      pagination: { nextCursor: "cursor-2", limit: 50, hasMore: true },
      concurrency: { version: 7, etag: "\"v7\"" },
      extensions: { source: "reference" },
    },
  });
});

test("success decoder rejects malformed envelope and does not trust compile-time types", () => {
  assert.equal(decodeApiSuccessEnvelope({ data: { id: 123, displayName: "Bad" }, requestId }, exampleDtoDecoder), null);
  assert.equal(decodeApiSuccessEnvelope({ data: { id: "ok", displayName: "Ok" }, requestId: "" }, exampleDtoDecoder), null);
  assert.equal(decodeApiSuccessEnvelope({
    data: { id: "ok", displayName: "Ok" },
    requestId,
    meta: { pagination: { nextCursor: null, limit: 0, hasMore: false } },
  }, exampleDtoDecoder), null);
});

test("shared metadata reserves common keys and uses extensions for project-specific metadata", () => {
  assert.deepEqual(decodeApiResponseMeta({ extensions: { tenantHint: "safe-value" } }), {
    extensions: { tenantHint: "safe-value" },
  });
  assert.equal(decodeApiResponseMeta({ productSpecificRootKey: true }), null);
  assert.equal(decodeApiResponseMeta({ concurrency: {} }), null);
});

test("existing API error response conforms to shared error envelope", async () => {
  const response = validationErrorResponse([
    { code: "required", path: "name", message: "Name is required" },
  ], requestId);
  const decoded = decodeApiErrorEnvelope(await response.json());

  assert.deepEqual(decoded, {
    error: {
      code: "validation_failed",
      message: "Validation failed",
      issues: [{ code: "required", path: "name", message: "Name is required" }],
    },
    requestId,
  });
});

test("error decoder preserves compatibility with bounded extra root fields while validating the common contract", async () => {
  const response = apiErrorResponse({
    status: 409,
    code: "conflict",
    message: "Conflict",
    extra: { currentVersion: 9 },
  }, requestId);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.currentVersion, 9);
  assert.deepEqual(decodeApiErrorEnvelope(payload), {
    error: { code: "conflict", message: "Conflict" },
    requestId,
  });
});

test("error decoder fails closed for malformed common fields", () => {
  assert.equal(decodeApiErrorEnvelope({ error: { code: "", message: "Bad" }, requestId }), null);
  assert.equal(decodeApiErrorEnvelope({ error: { code: "bad", message: "" }, requestId }), null);
  assert.equal(decodeApiErrorEnvelope({
    error: { code: "bad", message: "Bad", issues: [{ code: "x", message: 123 }] },
    requestId,
  }), null);
});

test("success envelope creator validates request id and shared metadata", () => {
  assert.deepEqual(createApiSuccessEnvelope({ id: "resource-1" }, requestId, {
    concurrency: { version: 1 },
  }), {
    data: { id: "resource-1" },
    requestId,
    meta: { concurrency: { version: 1 } },
  });

  assert.throws(() => createApiSuccessEnvelope({ id: "resource-1" }, ""), /requestId/);
  assert.throws(() => createApiSuccessEnvelope({ id: "resource-1" }, requestId, {
    pagination: { nextCursor: null, limit: 0, hasMore: false },
  }), /meta/);
});
