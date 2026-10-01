import assert from "node:assert/strict";
import test from "node:test";

import {
  MembershipRoleChangeError,
  changeMembershipRole,
} from "../src/worker/administration";
import { createMembershipRoleChangeAuditContext } from "../src/worker/audit";
import { findScopeMembership } from "../src/worker/authorization";

class FakeD1 {
  readonly memberships = new Map<string, { role: string; updatedAt: string }>();
  concurrentChange = false;

  private key(scopeId: string, userId: string) {
    return `${scopeId}:${userId}`;
  }

  seed(scopeId: string, userId: string, role: string) {
    this.memberships.set(this.key(scopeId, userId), { role, updatedAt: "2026-01-01T00:00:00.000Z" });
  }

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        first: async <T>() => {
          if (sql === "SELECT role FROM scope_memberships WHERE user_id=? AND scope_id=?") {
            const [userId, scopeId] = args as [string, string];
            const row = this.memberships.get(this.key(scopeId, userId));
            return (row ? { role: row.role } : null) as T | null;
          }
          if (sql.includes("SELECT scope_id AS scopeId,user_id AS userId,role FROM scope_memberships")) {
            const [userId, scopeId] = args as [string, string];
            const row = this.memberships.get(this.key(scopeId, userId));
            return (row ? { scopeId, userId, role: row.role } : null) as T | null;
          }
          throw new Error(`Unsupported first query: ${sql}`);
        },
        run: async () => {
          if (sql.startsWith("UPDATE scope_memberships SET role=?")) {
            const [nextRole, updatedAt, userId, scopeId, expectedRole] = args as [
              string,
              string,
              string,
              string,
              string,
            ];
            const key = this.key(scopeId, userId);
            const row = this.memberships.get(key);
            if (this.concurrentChange || !row || row.role !== expectedRole) {
              return { meta: { changes: 0 } };
            }
            this.memberships.set(key, { role: nextRole, updatedAt });
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unsupported run query: ${sql}`);
        },
      }),
    };
  }
}

const asD1 = (db: FakeD1) => db as unknown as D1Database;
const policy = { isValidRole: (role: string) => ["member", "reviewer", "approver"].includes(role) };
const baseInput = {
  actorId: "operator-1",
  userId: "user-1",
  scopeId: "scope-1",
  reason: "responsibility changed",
  now: new Date("2026-10-02T01:00:00.000Z"),
};

test("changes an existing membership role and updates authorization read model", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "reviewer");

  const result = await changeMembershipRole(asD1(fake), policy, {
    ...baseInput,
    nextRole: "approver",
  });

  assert.equal(result.kind, "changed");
  assert.equal(result.previousRole, "reviewer");
  assert.equal(result.nextRole, "approver");
  assert.equal((await findScopeMembership(asD1(fake), "user-1", "scope-1"))?.role, "approver");
});

test("no-op role change is explicit and does not mutate storage", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "reviewer");

  const result = await changeMembershipRole(asD1(fake), policy, {
    ...baseInput,
    nextRole: "reviewer",
  });

  assert.equal(result.kind, "unchanged");
  assert.equal(fake.memberships.get("scope-1:user-1")?.updatedAt, "2026-01-01T00:00:00.000Z");
});

test("rejects missing membership and roles outside project policy", async () => {
  const fake = new FakeD1();

  await assert.rejects(
    () => changeMembershipRole(asD1(fake), policy, { ...baseInput, nextRole: "reviewer" }),
    (error: unknown) =>
      error instanceof MembershipRoleChangeError && error.reasonCode === "membership_not_found",
  );

  fake.seed("scope-1", "user-1", "member");
  await assert.rejects(
    () => changeMembershipRole(asD1(fake), policy, { ...baseInput, nextRole: "root" }),
    (error: unknown) => error instanceof MembershipRoleChangeError && error.reasonCode === "invalid_role",
  );
});

test("detects concurrent role changes instead of overwriting them", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "member");
  fake.concurrentChange = true;

  await assert.rejects(
    () => changeMembershipRole(asD1(fake), policy, { ...baseInput, nextRole: "reviewer" }),
    (error: unknown) =>
      error instanceof MembershipRoleChangeError &&
      error.reasonCode === "membership_changed_concurrently",
  );
});

test("audit context preserves before and after roles without changing common AuditEvent", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "member");
  const result = await changeMembershipRole(asD1(fake), policy, {
    ...baseInput,
    nextRole: "reviewer",
  });

  const audit = createMembershipRoleChangeAuditContext({
    requestContext: { requestId: "req-94", method: "PATCH", path: "/api/admin/memberships/role" },
    result,
  });

  assert.equal(audit.previousRole, "member");
  assert.equal(audit.nextRole, "reviewer");
  assert.deepEqual(audit.event, {
    requestId: "req-94",
    method: "PATCH",
    path: "/api/admin/memberships/role",
    category: "authorization",
    action: "scope_membership_role_change",
    outcome: "success",
    actorId: "operator-1",
    scopeId: "scope-1",
    resourceType: "user",
    resourceId: "user-1",
    reason: "responsibility changed",
    affectedCount: 1,
  });
});
