import assert from "node:assert/strict";
import test from "node:test";

import {
  PrivilegedMembershipSafetyError,
  changeMembershipRoleSafely,
  removeScopeMembershipSafely,
} from "../src/worker/administration";
import { createPrivilegedMembershipSafetyAuditEvent } from "../src/worker/audit";
import {
  fromPrivilegedMembershipSafetyFailure,
  securityRejectionAuditEvent,
} from "../src/worker/security";

class FakeD1 {
  readonly memberships = new Map<string, { role: string; updatedAt: string }>();
  beforeConditionalMutation?: () => void;

  private key(scopeId: string, userId: string) {
    return `${scopeId}:${userId}`;
  }

  seed(scopeId: string, userId: string, role: string) {
    this.memberships.set(this.key(scopeId, userId), {
      role,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }

  private hasOtherPrivileged(
    scopeId: string,
    targetUserId: string,
    roles: readonly string[],
  ) {
    for (const [key, value] of this.memberships) {
      const [rowScopeId, rowUserId] = key.split(":");
      if (
        rowScopeId === scopeId &&
        rowUserId !== targetUserId &&
        roles.includes(value.role)
      ) {
        return true;
      }
    }
    return false;
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
          throw new Error(`Unsupported first query: ${sql}`);
        },
        run: async () => {
          if (sql.startsWith("DELETE FROM scope_memberships") && sql.includes("EXISTS")) {
            const [userId, scopeId, expectedRole, , , ...roles] = args as string[];
            this.beforeConditionalMutation?.();
            this.beforeConditionalMutation = undefined;
            const key = this.key(scopeId, userId);
            const row = this.memberships.get(key);
            if (
              !row ||
              row.role !== expectedRole ||
              !this.hasOtherPrivileged(scopeId, userId, roles)
            ) {
              return { meta: { changes: 0 } };
            }
            this.memberships.delete(key);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM scope_memberships")) {
            const [userId, scopeId, expectedRole] = args as [string, string, string];
            const key = this.key(scopeId, userId);
            const row = this.memberships.get(key);
            if (!row || row.role !== expectedRole) return { meta: { changes: 0 } };
            this.memberships.delete(key);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE scope_memberships") && sql.includes("EXISTS")) {
            const [nextRole, updatedAt, userId, scopeId, expectedRole, , , ...roles] = args as string[];
            this.beforeConditionalMutation?.();
            this.beforeConditionalMutation = undefined;
            const key = this.key(scopeId, userId);
            const row = this.memberships.get(key);
            if (
              !row ||
              row.role !== expectedRole ||
              !this.hasOtherPrivileged(scopeId, userId, roles)
            ) {
              return { meta: { changes: 0 } };
            }
            this.memberships.set(key, { role: nextRole, updatedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE scope_memberships")) {
            const [nextRole, updatedAt, userId, scopeId, expectedRole] = args as [
              string,
              string,
              string,
              string,
              string,
            ];
            const key = this.key(scopeId, userId);
            const row = this.memberships.get(key);
            if (!row || row.role !== expectedRole) return { meta: { changes: 0 } };
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
const privilegedPolicy = {
  getPrivilegedRoles: (_scopeId: string) => ["manager", "operator"],
};
const rolePolicy = {
  isValidRole: (role: string) => ["member", "manager", "operator"].includes(role),
};
const now = new Date("2026-10-02T02:00:00.000Z");

test("rejects privileged self-removal even when another privileged member exists", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "manager");
  fake.seed("scope-1", "user-2", "operator");

  await assert.rejects(
    () =>
      removeScopeMembershipSafely(asD1(fake), privilegedPolicy, {
        actorId: "user-1",
        userId: "user-1",
        scopeId: "scope-1",
        reason: "leave admin role",
        now,
      }),
    (error: unknown) =>
      error instanceof PrivilegedMembershipSafetyError &&
      error.reasonCode === "self_privileged_membership_change_denied",
  );
  assert.equal(fake.memberships.get("scope-1:user-1")?.role, "manager");
});

test("allows another actor to remove a privileged membership when one remains", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "manager");
  fake.seed("scope-1", "user-2", "operator");

  const result = await removeScopeMembershipSafely(asD1(fake), privilegedPolicy, {
    actorId: "operator-9",
    userId: "user-1",
    scopeId: "scope-1",
    reason: "responsibility transfer",
    now,
  });

  assert.equal(result.kind, "removed");
  assert.equal(fake.memberships.has("scope-1:user-1"), false);
  assert.equal(fake.memberships.get("scope-1:user-2")?.role, "operator");
});

test("rejects removing the last privileged membership", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "manager");
  fake.seed("scope-1", "user-2", "member");

  await assert.rejects(
    () =>
      removeScopeMembershipSafely(asD1(fake), privilegedPolicy, {
        actorId: "operator-9",
        userId: "user-1",
        scopeId: "scope-1",
        reason: "cleanup",
        now,
      }),
    (error: unknown) =>
      error instanceof PrivilegedMembershipSafetyError &&
      error.reasonCode === "last_privileged_membership",
  );
});

test("rejects privileged self-downgrade but allows privileged-to-privileged role change", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "manager");
  fake.seed("scope-1", "user-2", "operator");

  await assert.rejects(
    () =>
      changeMembershipRoleSafely(asD1(fake), rolePolicy, privilegedPolicy, {
        actorId: "user-1",
        userId: "user-1",
        scopeId: "scope-1",
        nextRole: "member",
        reason: "reduce access",
        now,
      }),
    (error: unknown) =>
      error instanceof PrivilegedMembershipSafetyError &&
      error.reasonCode === "self_privileged_membership_change_denied",
  );

  const result = await changeMembershipRoleSafely(asD1(fake), rolePolicy, privilegedPolicy, {
    actorId: "user-1",
    userId: "user-1",
    scopeId: "scope-1",
    nextRole: "operator",
    reason: "role alignment",
    now,
  });
  assert.equal(result.kind, "changed");
  assert.equal(fake.memberships.get("scope-1:user-1")?.role, "operator");
});

test("conditional mutation re-check prevents concurrent loss of the final privileged membership", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "manager");
  fake.seed("scope-1", "user-2", "operator");
  fake.beforeConditionalMutation = () => {
    fake.memberships.delete("scope-1:user-2");
  };

  await assert.rejects(
    () =>
      changeMembershipRoleSafely(asD1(fake), rolePolicy, privilegedPolicy, {
        actorId: "operator-9",
        userId: "user-1",
        scopeId: "scope-1",
        nextRole: "member",
        reason: "reduce access",
        now,
      }),
    (error: unknown) =>
      error instanceof PrivilegedMembershipSafetyError &&
      error.reasonCode === "last_privileged_membership",
  );
  assert.equal(fake.memberships.get("scope-1:user-1")?.role, "manager");
});

test("invalid privileged-role policy fails closed", async () => {
  const fake = new FakeD1();
  fake.seed("scope-1", "user-1", "member");

  await assert.rejects(
    () =>
      removeScopeMembershipSafely(
        asD1(fake),
        { getPrivilegedRoles: () => [] },
        {
          actorId: "operator-9",
          userId: "user-1",
          scopeId: "scope-1",
          reason: "cleanup",
          now,
        },
      ),
    (error: unknown) =>
      error instanceof PrivilegedMembershipSafetyError &&
      error.reasonCode === "privileged_role_policy_invalid",
  );
});

test("rejection connects to Audit and Security Rejection Event without role vocabulary", () => {
  const error = new PrivilegedMembershipSafetyError(
    "last_privileged_membership",
    "would lose management access",
  );
  const requestContext = {
    requestId: "req-97",
    method: "DELETE",
    path: "/api/admin/memberships/user-1",
  };

  const audit = createPrivilegedMembershipSafetyAuditEvent({
    requestContext,
    actorId: "operator-9",
    targetUserId: "user-1",
    scopeId: "scope-1",
    error,
  });
  assert.equal(audit.reason, "last_privileged_membership");
  assert.equal(audit.affectedCount, 0);

  const security = fromPrivilegedMembershipSafetyFailure(error, {
    ...requestContext,
    actorId: "operator-9",
    scopeId: "scope-1",
    resourceType: "user",
    resourceId: "user-1",
    timestamp: now,
  });
  assert.equal(security.eventType, "administration_rejected");
  assert.equal(security.reasonCode, "last_privileged_membership");
  assert.equal(securityRejectionAuditEvent(security).category, "authorization");
  assert.equal(JSON.stringify(security).includes("manager"), false);
  assert.equal("role" in security, false);
});
