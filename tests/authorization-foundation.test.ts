import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeScopedAction,
  findScopeMembership,
  type RolePolicy,
  type ScopeMembership,
} from "../src/worker/authorization";

const policy: RolePolicy = {
  "resource:read": ["reader", "editor"],
  "resource:write": ["editor"],
};

const membership: ScopeMembership = {
  scopeId: "scope-a",
  userId: "user-1",
  role: "editor",
};

test("findScopeMembership maps the D1 row without embedding role semantics", async () => {
  let boundValues: unknown[] = [];
  const db = {
    prepare(sql: string) {
      assert.match(sql, /FROM scope_memberships/);
      return {
        bind(...values: unknown[]) {
          boundValues = values;
          return {
            async first<T>() {
              return {
                scopeId: "scope-a",
                userId: "user-1",
                role: "custom-role",
              } as T;
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  const result = await findScopeMembership(db, "user-1", "scope-a");

  assert.deepEqual(boundValues, ["user-1", "scope-a"]);
  assert.deepEqual(result, {
    scopeId: "scope-a",
    userId: "user-1",
    role: "custom-role",
  });
});

test("membership is required", () => {
  assert.deepEqual(
    authorizeScopedAction(policy, {
      action: "resource:read",
      requestedScopeId: "scope-a",
      resourceScopeId: "scope-a",
      membership: null,
    }),
    { allowed: false, reason: "membership_required" },
  );
});

test("an allowed project-defined role is accepted", () => {
  assert.deepEqual(
    authorizeScopedAction(policy, {
      action: "resource:write",
      requestedScopeId: "scope-a",
      resourceScopeId: "scope-a",
      membership,
    }),
    { allowed: true, role: "editor" },
  );
});

test("a role that is not allowed for the action is denied", () => {
  assert.deepEqual(
    authorizeScopedAction(policy, {
      action: "resource:write",
      requestedScopeId: "scope-a",
      resourceScopeId: "scope-a",
      membership: { ...membership, role: "reader" },
    }),
    { allowed: false, reason: "role_required" },
  );
});

test("membership from another scope is denied", () => {
  assert.deepEqual(
    authorizeScopedAction(policy, {
      action: "resource:read",
      requestedScopeId: "scope-a",
      resourceScopeId: "scope-a",
      membership: { ...membership, scopeId: "scope-b" },
    }),
    { allowed: false, reason: "membership_scope_mismatch" },
  );
});

test("resource scope mismatch is denied even for an allowed role", () => {
  assert.deepEqual(
    authorizeScopedAction(policy, {
      action: "resource:read",
      requestedScopeId: "scope-a",
      resourceScopeId: "scope-b",
      membership,
    }),
    { allowed: false, reason: "resource_scope_mismatch" },
  );
});

test("unconfigured actions fail closed", () => {
  assert.deepEqual(
    authorizeScopedAction(policy, {
      action: "resource:delete",
      requestedScopeId: "scope-a",
      resourceScopeId: "scope-a",
      membership,
    }),
    { allowed: false, reason: "action_not_configured" },
  );
});
