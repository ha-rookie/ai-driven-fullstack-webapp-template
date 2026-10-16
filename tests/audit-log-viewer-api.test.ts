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


const auditDbForRole = (role: string | null) => {
  const calls: Array<{ readonly sql: string; readonly values: readonly unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return { bind(...values: unknown[]) {
        calls.push({ sql, values });
        return {
          first: async () => sql.includes("JOIN users") ? {
            id: "fixture-admin", displayName: "Fixture", lastSeenAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          } : role === null ? null : { userId: "fixture-admin", scopeId: "workhub-company", role },
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 0 } }),
        };
      } };
    },
  } as unknown as D1Database;
  return { db, calls };
};

test("#420 valid Audit request correlation is scoped, exact and authorized", async () => {
  const endpoint = "https://example.test/api/admin/audit?scopeId=workhub-company&requestId=CF-123.NRT";
  const admin = auditDbForRole("system_admin");
  const request = new Request(endpoint, { headers: { cookie: "app_session=synthetic-session-only" } });
  const response = await handleAuditLogViewerApi(request, {
    DB: admin.db, RUNTIME_ENVIRONMENT: "test",
  }, "audit-lookup");
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  const query = admin.calls.find(call => call.sql.includes("FROM durable_audit_events"));
  assert.ok(query);
  assert.match(query.sql, /scope_id = \?/u);
  assert.match(query.sql, /request_id = \?/u);
  assert.ok(query.values.includes("CF-123.NRT"));
  assert.equal(query.sql.includes("CF-123.NRT"), false);
});

test("#420 Audit correlation rejects unsafe IDs and denies unauthorized access before DB query", async () => {
  const endpoints = [
    "requestId=ghp_secret",
    "requestId=unsafe%20space",
    "requestId=https%3A%2F%2Fevil.test",
    "requestId=abc%0Ainjected",
    `requestId=${"a".repeat(129)}`,
  ];
  for (const suffix of endpoints) {
    const admin = auditDbForRole("system_admin");
    const response = await handleAuditLogViewerApi(new Request(
      `https://example.test/api/admin/audit?scopeId=workhub-company&${suffix}`,
      { headers: { cookie: "app_session=synthetic-session-only" } },
    ), { DB: admin.db, RUNTIME_ENVIRONMENT: "test" }, "invalid-audit");
    assert.equal(response?.status, 400, suffix);
    assert.equal(admin.calls.some(call => call.sql.includes("FROM durable_audit_events")), false);
  }
  const anonymous = auditDbForRole("system_admin");
  const denied = await handleAuditLogViewerApi(new Request(
    "https://example.test/api/admin/audit?scopeId=workhub-company&requestId=good-audit",
  ), { DB: anonymous.db, RUNTIME_ENVIRONMENT: "test" }, "anonymous");
  assert.equal(denied?.status, 401);
  assert.equal(anonymous.calls.some(call => call.sql.includes("FROM durable_audit_events")), false);
  const employee = auditDbForRole("employee");
  const forbidden = await handleAuditLogViewerApi(new Request(
    "https://example.test/api/admin/audit?scopeId=workhub-company&requestId=good-audit",
    { headers: { cookie: "app_session=synthetic-session-only" } },
  ), { DB: employee.db, RUNTIME_ENVIRONMENT: "test" }, "denied");
  assert.equal(forbidden?.status, 403);
  assert.equal(employee.calls.some(call => call.sql.includes("FROM durable_audit_events")), false);
});
