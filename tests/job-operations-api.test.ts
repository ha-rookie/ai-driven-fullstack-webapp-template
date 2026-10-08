import assert from "node:assert/strict";
import test from "node:test";

import { handleJobOperationsApi } from "../src/worker/administration";

const dbWithoutSession = {
  prepare() {
    return {
      bind() {
        return {
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 0 } }),
        };
      },
    };
  },
} as unknown as D1Database;

test("returns null outside the job operations route", async () => {
  const response = await handleJobOperationsApi(
    new Request("https://example.test/api/admin/other"),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-job-1",
  );
  assert.equal(response, null);
});

test("rejects mutation methods before authentication", async () => {
  const response = await handleJobOperationsApi(
    new Request("https://example.test/api/admin/jobs?scopeId=scope-1", { method: "POST" }),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-job-2",
  );
  assert.equal(response?.status, 405);
});

test("requires authentication", async () => {
  const response = await handleJobOperationsApi(
    new Request("https://example.test/api/admin/jobs?scopeId=scope-1"),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-job-3",
  );
  assert.equal(response?.status, 401);
});

test("rejects invalid state filter", async () => {
  const response = await handleJobOperationsApi(
    new Request("https://example.test/api/admin/jobs?scopeId=scope-1&state=unknown"),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-job-4",
  );
  assert.equal(response?.status, 401);
});
