import assert from "node:assert/strict";
import test from "node:test";

import { handleAdministrationApi } from "../src/worker/administration";
import { LocalRateLimitStore, RateLimitGuard } from "../src/worker/http";

const dbWithoutSession = {
  prepare() {
    return {
      bind() {
        return {
          first: async () => null,
          run: async () => ({ meta: { changes: 0 } }),
          all: async () => ({ results: [] }),
        };
      },
    };
  },
} as unknown as D1Database;

const options = {
  authorizationPolicy: { "administration:manage": ["manager"] },
  membershipRolePolicy: { isValidRole: (role: string) => role === "member" || role === "manager" },
  privilegedMembershipPolicy: { getPrivilegedRoles: () => ["manager"] },
  invitationRolePolicy: { isAllowed: (role: string) => role === "member" || role === "manager" },
  userLifecycleScopePolicy: { canManageUser: () => true },
  rateLimitGuard: new RateLimitGuard(new LocalRateLimitStore()),
  rateLimitPolicy: { endpointId: "admin-api", limit: 10, windowSeconds: 60 },
};

const audit = () => undefined;

test("returns null outside the administration API namespace", async () => {
  const response = await handleAdministrationApi(
    new Request("https://example.test/api/other"),
    dbWithoutSession,
    audit,
    "req-1",
    options,
  );
  assert.equal(response, null);
});

test("rejects unsupported methods before authentication", async () => {
  const response = await handleAdministrationApi(
    new Request("https://example.test/api/admin/scopes/scope-1/memberships", {
      method: "GET",
    }),
    dbWithoutSession,
    audit,
    "req-2",
    options,
  );

  assert.equal(response?.status, 405);
  const body = (await response?.json()) as { error: { code: string }; requestId: string };
  assert.equal(body.error.code, "method_not_allowed");
  assert.equal(body.requestId, "req-2");
});

test("requires authentication for administration endpoints and emits a security rejection", async () => {
  const events: unknown[] = [];
  const response = await handleAdministrationApi(
    new Request("https://example.test/api/admin/scopes/scope-1/users/user-1/sessions"),
    dbWithoutSession,
    audit,
    "req-3",
    { ...options, securityEventSink: (event) => events.push(event) },
  );

  assert.equal(response?.status, 401);
  const body = (await response?.json()) as { error: { code: string }; requestId: string };
  assert.equal(body.error.code, "authentication_required");
  assert.equal(body.requestId, "req-3");
  assert.equal(events.length, 1);
  assert.equal(
    (events[0] as { eventType: string }).eventType,
    "authentication_rejected",
  );
});

test("malformed encoded path does not enter the administration boundary", async () => {
  const response = await handleAdministrationApi(
    new Request("https://example.test/api/admin/scopes/%E0%A4%A/memberships", {
      method: "POST",
    }),
    dbWithoutSession,
    audit,
    "req-4",
    options,
  );
  assert.equal(response, null);
});
