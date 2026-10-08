import assert from "node:assert/strict";
import test from "node:test";

import { handleAuditLogViewerApi } from "../src/worker/administration";

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

test("returns null outside the audit viewer route", async () => {
  const response = await handleAuditLogViewerApi(
    new Request("https://example.test/api/admin/other"),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-audit-1",
  );
  assert.equal(response, null);
});

test("rejects mutation methods before authentication", async () => {
  const response = await handleAuditLogViewerApi(
    new Request("https://example.test/api/admin/audit?scopeId=scope-1", { method: "POST" }),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-audit-2",
  );
  assert.equal(response?.status, 405);
  const body = await response?.json() as { error: { code: string } };
  assert.equal(body.error.code, "method_not_allowed");
});

test("requires an explicit runtime environment", async () => {
  const response = await handleAuditLogViewerApi(
    new Request("https://example.test/api/admin/audit?scopeId=scope-1"),
    { DB: dbWithoutSession },
    "req-audit-3",
  );
  assert.equal(response?.status, 503);
  const body = await response?.json() as { error: { code: string } };
  assert.equal(body.error.code, "runtime_environment_required");
});

test("requires authentication before audit search", async () => {
  const response = await handleAuditLogViewerApi(
    new Request("https://example.test/api/admin/audit?scopeId=scope-1"),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-audit-4",
  );
  assert.equal(response?.status, 401);
  const body = await response?.json() as { error: { code: string } };
  assert.equal(body.error.code, "authentication_required");
});
