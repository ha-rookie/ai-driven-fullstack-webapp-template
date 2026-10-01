import assert from "node:assert/strict";
import test from "node:test";

import {
  MembershipMutationError,
  addScopeMembership,
  removeScopeMembership,
} from "../src/worker/administration";
import { createScopeMembershipAuditEvent } from "../src/worker/audit";
import { findScopeMembership } from "../src/worker/authorization";

interface FakeMembership {
  scopeId: string;
  userId: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

class FakeD1 {
  readonly users = new Set<string>();
  readonly scopes = new Set<string>();
  readonly memberships = new Map<string, FakeMembership>();

  private key(scopeId: string, userId: string) {
    return `${scopeId}:${userId}`;
  }

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        first: async <T>() => {
          if (sql === "SELECT id FROM users WHERE id=?") {
            const [id] = args as [string];
            return (this.users.has(id) ? { id } : null) as T | null;
          }
          if (sql === "SELECT id FROM resource_scopes WHERE id=?") {
            const [id] = args as [string];
            return (this.scopes.has(id) ? { id } : null) as T | null;
          }
          if (sql.includes("FROM scope_memberships WHERE user_id=? AND scope_id=?")) {
            const [userId, scopeId] = args as [string, string];
            const row = this.memberships.get(this.key(scopeId, userId));
            return (row
              ? { scopeId: row.scopeId, userId: row.userId, role: row.role }
              : null) as T | null;
          }
          throw new Error(`Unsupported first query: ${sql}`);
        },
        run: async () => {
          if (sql.startsWith("INSERT OR IGNORE INTO scope_memberships")) {
            const [scopeId, userId, role, createdAt, updatedAt] = args as [
              string,
              string,
              string,
              string,
              string,
            ];
            const key = this.key(scopeId, userId);
            if (this.memberships.has(key)) return { meta: { changes: 0 } };
            this.memberships.set(key, {
              scopeId,
              userId,
              role,
              createdAt,
              updatedAt,
            });
            return { meta: { changes: 1 } };
          }
          if (sql === "DELETE FROM scope_memberships WHERE user_id=? AND scope_id=? AND role=?") {
            const [userId, scopeId, role] = args as [string, string, string];
            const key = this.key(scopeId, userId);
            const row = this.memberships.get(key);
            if (!row || row.role !== role) return { meta: { changes: 0 } };
            this.memberships.delete(key);
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unsupported run query: ${sql}`);
        },
      }),
    };
  }
}

const asD1 = (db: FakeD1) => db as unknown as D1Database;
const context = {
  actorId: "operator-1",
  reason: "grant project access",
  now: new Date("2026-10-02T00:00:00.000Z"),
};

test("add membership creates a role-neutral membership and audit context", async () => {
  const fake = new FakeD1();
  fake.users.add("user-1");
  fake.scopes.add("scope-1");

  const result = await addScopeMembership(asD1(fake), {
    ...context,
    userId: "user-1",
    scopeId: "scope-1",
    role: "reviewer",
  });

  assert.equal(result.kind, "added");
  assert.equal((await findScopeMembership(asD1(fake), "user-1", "scope-1"))?.role, "reviewer");
  assert.deepEqual(
    createScopeMembershipAuditEvent({
      requestContext: { requestId: "req-1", method: "POST", path: "/api/admin/memberships" },
      result,
    }),
    {
      requestId: "req-1",
      method: "POST",
      path: "/api/admin/memberships",
      category: "authorization",
      action: "scope_membership_add",
      outcome: "success",
      actorId: "operator-1",
      scopeId: "scope-1",
      resourceType: "user",
      resourceId: "user-1",
      reason: "grant project access",
      affectedCount: 1,
    },
  );
});

test("duplicate same-role add is idempotent but a different role must use role-change service", async () => {
  const fake = new FakeD1();
  fake.users.add("user-1");
  fake.scopes.add("scope-1");

  const input = { ...context, userId: "user-1", scopeId: "scope-1", role: "reviewer" };
  await addScopeMembership(asD1(fake), input);
  const duplicate = await addScopeMembership(asD1(fake), input);
  assert.equal(duplicate.kind, "already_exists");

  await assert.rejects(
    () => addScopeMembership(asD1(fake), { ...input, role: "approver" }),
    (error: unknown) =>
      error instanceof MembershipMutationError && error.reasonCode === "membership_role_mismatch",
  );
});

test("missing user or scope is rejected explicitly", async () => {
  const fake = new FakeD1();
  fake.scopes.add("scope-1");

  await assert.rejects(
    () =>
      addScopeMembership(asD1(fake), {
        ...context,
        userId: "missing-user",
        scopeId: "scope-1",
        role: "member",
      }),
    (error: unknown) => error instanceof MembershipMutationError && error.reasonCode === "user_not_found",
  );

  fake.users.add("user-1");
  await assert.rejects(
    () =>
      addScopeMembership(asD1(fake), {
        ...context,
        userId: "user-1",
        scopeId: "missing-scope",
        role: "member",
      }),
    (error: unknown) => error instanceof MembershipMutationError && error.reasonCode === "scope_not_found",
  );
});

test("remove membership immediately removes the authorization read model", async () => {
  const fake = new FakeD1();
  fake.users.add("user-1");
  fake.scopes.add("scope-1");
  await addScopeMembership(asD1(fake), {
    ...context,
    userId: "user-1",
    scopeId: "scope-1",
    role: "member",
  });

  const result = await removeScopeMembership(asD1(fake), {
    ...context,
    reason: "access no longer required",
    userId: "user-1",
    scopeId: "scope-1",
  });

  assert.equal(result.kind, "removed");
  assert.equal(await findScopeMembership(asD1(fake), "user-1", "scope-1"), null);
});
