import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizationGuardFailureResponse,
  requireAuthenticatedUser,
  requireScopedAuthorization,
  type RolePolicy,
} from "../src/worker/authorization";

const policy: RolePolicy = {
  "resource:read": ["viewer", "editor"],
  "resource:write": ["editor"],
};

const membershipDb = (
  membership: { scopeId: string; userId: string; role: string } | null,
): D1Database =>
  ({
    prepare(sql: string) {
      assert.match(sql, /FROM scope_memberships/);
      return {
        bind() {
          return {
            async first<T>() {
              return membership as T | null;
            },
          };
        },
      };
    },
  }) as unknown as D1Database;

const sessionDb = (): D1Database =>
  ({
    prepare(sql: string) {
      assert.match(sql, /FROM application_sessions/);
      return {
        bind() {
          return {
            async first<T>() {
              return {
                id: "user-1",
                displayName: "Example User",
                expiresAt: "2099-01-01T00:00:00.000Z",
              } as T;
            },
          };
        },
      };
    },
  }) as unknown as D1Database;

test("authentication guard returns a unified 401 when no valid session exists", async () => {
  const request = new Request("https://example.test/api/resource");
  const result = await requireAuthenticatedUser(request, {} as D1Database);

  assert.deepEqual(result, {
    allowed: false,
    status: 401,
    code: "authentication_required",
    message: "Authentication required",
    reason: "session_missing_or_invalid",
  });

  const response = authorizationGuardFailureResponse(result);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: "authentication_required",
      message: "Authentication required",
    },
  });
});

test("authentication guard returns the internal application user", async () => {
  const request = new Request("https://example.test/api/resource", {
    headers: { cookie: "app_session=guard-token" },
  });
  const result = await requireAuthenticatedUser(request, sessionDb());

  assert.deepEqual(result, {
    allowed: true,
    user: { id: "user-1", displayName: "Example User" },
  });
});

test("authentication dependency failures are not converted to 401", async () => {
  const request = new Request("https://example.test/api/resource", {
    headers: { cookie: "app_session=guard-token" },
  });
  const db = {
    prepare() {
      throw new Error("database unavailable");
    },
  } as unknown as D1Database;

  await assert.rejects(() => requireAuthenticatedUser(request, db));
});

test("scoped authorization guard allows an in-scope permitted role", async () => {
  const result = await requireScopedAuthorization({
    db: membershipDb({ scopeId: "scope-a", userId: "user-1", role: "editor" }),
    userId: "user-1",
    policy,
    action: "resource:write",
    requestedScopeId: "scope-a",
    resourceScopeId: "scope-a",
  });

  assert.deepEqual(result, {
    allowed: true,
    membership: { scopeId: "scope-a", userId: "user-1", role: "editor" },
    role: "editor",
  });
});

test("missing membership is denied with a generic 403 response", async () => {
  const result = await requireScopedAuthorization({
    db: membershipDb(null),
    userId: "user-1",
    policy,
    action: "resource:read",
    requestedScopeId: "scope-a",
    resourceScopeId: "scope-a",
  });

  assert.deepEqual(result, {
    allowed: false,
    status: 403,
    code: "forbidden",
    message: "Access denied",
    reason: "membership_required",
  });

  if (result.allowed) assert.fail("expected authorization denial");
  const response = authorizationGuardFailureResponse(result);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: { code: "forbidden", message: "Access denied" },
  });
});

test("insufficient role is denied by the existing pure policy", async () => {
  const result = await requireScopedAuthorization({
    db: membershipDb({ scopeId: "scope-a", userId: "user-1", role: "viewer" }),
    userId: "user-1",
    policy,
    action: "resource:write",
    requestedScopeId: "scope-a",
    resourceScopeId: "scope-a",
  });

  assert.deepEqual(result, {
    allowed: false,
    status: 403,
    code: "forbidden",
    message: "Access denied",
    reason: "role_required",
  });
});

test("resource scope mismatch and unconfigured action fail closed", async () => {
  const db = membershipDb({
    scopeId: "scope-a",
    userId: "user-1",
    role: "editor",
  });

  const scopeMismatch = await requireScopedAuthorization({
    db,
    userId: "user-1",
    policy,
    action: "resource:read",
    requestedScopeId: "scope-a",
    resourceScopeId: "scope-b",
  });
  assert.equal(scopeMismatch.allowed, false);
  if (!scopeMismatch.allowed) {
    assert.equal(scopeMismatch.reason, "resource_scope_mismatch");
  }

  const unconfigured = await requireScopedAuthorization({
    db,
    userId: "user-1",
    policy,
    action: "resource:delete",
    requestedScopeId: "scope-a",
    resourceScopeId: "scope-a",
  });
  assert.equal(unconfigured.allowed, false);
  if (!unconfigured.allowed) {
    assert.equal(unconfigured.reason, "action_not_configured");
  }
});

test("authorization dependency failures are not converted to 403", async () => {
  const db = {
    prepare() {
      throw new Error("database unavailable");
    },
  } as unknown as D1Database;

  await assert.rejects(() =>
    requireScopedAuthorization({
      db,
      userId: "user-1",
      policy,
      action: "resource:read",
      requestedScopeId: "scope-a",
      resourceScopeId: "scope-a",
    }),
  );
});
