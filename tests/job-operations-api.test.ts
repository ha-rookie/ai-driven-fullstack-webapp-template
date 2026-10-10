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

test("summary is read-only and refuses unauthenticated callers", async () => {
  const target = "https://example.test/api/admin/jobs/summary?scopeId=workhub-company";
  const env = { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" };
  const method = await handleJobOperationsApi(new Request(target, { method: "POST" }), env, "req-summary-method", {
    singleScopeSummaryId: "workhub-company",
  });
  assert.equal(method?.status, 405);
  const anonymous = await handleJobOperationsApi(new Request(target), env, "req-summary-anonymous", {
    singleScopeSummaryId: "workhub-company",
  });
  assert.equal(anonymous?.status, 401);
  const unrelated = await handleJobOperationsApi(new Request("https://example.test/api/admin/jobs/metrics"), env, "req-summary-unknown");
  assert.equal(unrelated, null);
});

test("summary rejects arbitrary caller-defined filters and missing scope", async () => {
  const env = { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" };
  const options = { singleScopeSummaryId: "workhub-company" };
  for (const query of ["", "?scopeId=workhub-company&state=failed", "?scopeId=workhub-company&scopeId=workhub-company"]) {
    const response = await handleJobOperationsApi(
      new Request("https://example.test/api/admin/jobs/summary" + query),
      env, "req-summary-bad-query", options,
    );
    assert.equal(response?.status, 400);
  }
});
