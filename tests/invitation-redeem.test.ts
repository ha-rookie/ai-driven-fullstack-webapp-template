import assert from "node:assert/strict";
import test from "node:test";

import {
  InvitationRedeemError,
  hashInvitationToken,
  redeemInvitation,
} from "../src/worker/administration";
import { createInvitationRedeemAuditContext } from "../src/worker/audit";

interface InvitationRow {
  id: string;
  tokenHash: string;
  scopeId: string;
  inviteeIdentifier: string | null;
  intendedRole: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

interface MembershipRow {
  scopeId: string;
  userId: string;
  role: string;
}

class FakeStatement {
  constructor(
    readonly db: FakeD1,
    readonly sql: string,
    readonly args: unknown[] = [],
  ) {}

  bind(...args: unknown[]) {
    return new FakeStatement(this.db, this.sql, args);
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM scope_invitations") && this.sql.includes("WHERE token_hash=?")) {
      const [tokenHash] = this.args as [string];
      const row = [...this.db.invitations.values()].find((item) => item.tokenHash === tokenHash);
      return (row
        ? {
            id: row.id,
            scopeId: row.scopeId,
            inviteeIdentifier: row.inviteeIdentifier,
            intendedRole: row.intendedRole,
            expiresAt: row.expiresAt,
            redeemedAt: row.redeemedAt,
            revokedAt: row.revokedAt,
          }
        : null) as T | null;
    }

    if (this.sql === "SELECT id FROM users WHERE id=? AND status='active'") {
      const [userId] = this.args as [string];
      return (this.db.activeUsers.has(userId) ? { id: userId } : null) as T | null;
    }

    if (this.sql === "SELECT role FROM scope_memberships WHERE scope_id=? AND user_id=?") {
      const [scopeId, userId] = this.args as [string, string];
      const membership = this.db.memberships.get(`${scopeId}:${userId}`);
      return (membership ? { role: membership.role } : null) as T | null;
    }

    throw new Error(`Unsupported first query: ${this.sql}`);
  }

  async run(): Promise<{ meta: { changes: number } }> {
    if (this.sql.startsWith("UPDATE scope_invitations") && this.sql.includes("AND EXISTS (")) {
      const [redeemedAt, id, tokenHash, cutoff, scopeId, userId, role] = this.args as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const invitation = this.db.invitations.get(id);
      const membership = this.db.memberships.get(`${scopeId}:${userId}`);
      if (
        !invitation ||
        invitation.tokenHash !== tokenHash ||
        invitation.revokedAt ||
        invitation.redeemedAt ||
        invitation.expiresAt <= cutoff ||
        !membership ||
        membership.role !== role
      ) {
        this.db.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      invitation.redeemedAt = redeemedAt;
      this.db.lastChanges = 1;
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE scope_invitations")) {
      const [redeemedAt, id, tokenHash, cutoff] = this.args as [string, string, string, string];
      const invitation = this.db.invitations.get(id);
      if (
        !invitation ||
        invitation.tokenHash !== tokenHash ||
        invitation.revokedAt ||
        invitation.redeemedAt ||
        invitation.expiresAt <= cutoff
      ) {
        this.db.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      invitation.redeemedAt = redeemedAt;
      this.db.lastChanges = 1;
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT INTO scope_memberships")) {
      const [scopeId, userId, role] = this.args as [string, string, string, string, string];
      if (this.db.lastChanges !== 1) {
        this.db.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      const key = `${scopeId}:${userId}`;
      if (this.db.memberships.has(key)) {
        throw new Error("UNIQUE constraint failed: scope_memberships.scope_id, scope_memberships.user_id");
      }
      this.db.memberships.set(key, { scopeId, userId, role });
      this.db.lastChanges = 1;
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unsupported run query: ${this.sql}`);
  }
}

class FakeD1 {
  readonly invitations = new Map<string, InvitationRow>();
  readonly memberships = new Map<string, MembershipRow>();
  readonly activeUsers = new Set<string>();
  lastChanges = 0;

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]) {
    const invitationSnapshot = new Map(
      [...this.invitations.entries()].map(([key, value]) => [key, { ...value }]),
    );
    const membershipSnapshot = new Map(
      [...this.memberships.entries()].map(([key, value]) => [key, { ...value }]),
    );
    const previousChanges = this.lastChanges;

    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.invitations.clear();
      for (const [key, value] of invitationSnapshot) this.invitations.set(key, value);
      this.memberships.clear();
      for (const [key, value] of membershipSnapshot) this.memberships.set(key, value);
      this.lastChanges = previousChanges;
      throw error;
    }
  }
}

const asD1 = (db: FakeD1) => db as unknown as D1Database;
const now = new Date("2026-10-02T00:00:00.000Z");
const token = "redeem-token-1";

const seedInvitation = async (
  db: FakeD1,
  overrides: Partial<InvitationRow> = {},
): Promise<InvitationRow> => {
  const row: InvitationRow = {
    id: "invite-1",
    tokenHash: await hashInvitationToken(token),
    scopeId: "scope-1",
    inviteeIdentifier: null,
    intendedRole: "member",
    expiresAt: "2026-10-03T00:00:00.000Z",
    redeemedAt: null,
    revokedAt: null,
    ...overrides,
  };
  db.invitations.set(row.id, row);
  return row;
};

test("redeem creates membership and consumes invitation atomically", async () => {
  const db = new FakeD1();
  db.activeUsers.add("user-1");
  await seedInvitation(db);

  const result = await redeemInvitation(asD1(db), {
    redeemToken: token,
    authenticatedUserId: "user-1",
    reason: "accept invitation",
    now,
  });

  assert.equal(result.membershipKind, "added");
  assert.equal(db.memberships.get("scope-1:user-1")?.role, "member");
  assert.equal(db.invitations.get("invite-1")?.redeemedAt, now.toISOString());

  await assert.rejects(
    () =>
      redeemInvitation(asD1(db), {
        redeemToken: token,
        authenticatedUserId: "user-1",
        reason: "replay",
        now,
      }),
    (error: unknown) =>
      error instanceof InvitationRedeemError &&
      error.reasonCode === "invitation_already_redeemed",
  );
});

test("expired and revoked invitations fail closed", async () => {
  const expired = new FakeD1();
  expired.activeUsers.add("user-1");
  await seedInvitation(expired, { expiresAt: "2026-10-01T00:00:00.000Z" });
  await assert.rejects(
    () =>
      redeemInvitation(asD1(expired), {
        redeemToken: token,
        authenticatedUserId: "user-1",
        reason: "expired",
        now,
      }),
    (error: unknown) =>
      error instanceof InvitationRedeemError && error.reasonCode === "invitation_expired",
  );

  const revoked = new FakeD1();
  revoked.activeUsers.add("user-1");
  await seedInvitation(revoked, { revokedAt: "2026-10-01T12:00:00.000Z" });
  await assert.rejects(
    () =>
      redeemInvitation(asD1(revoked), {
        redeemToken: token,
        authenticatedUserId: "user-1",
        reason: "revoked",
        now,
      }),
    (error: unknown) =>
      error instanceof InvitationRedeemError && error.reasonCode === "invitation_revoked",
  );
});

test("targeted invitation requires Project identity matching", async () => {
  const db = new FakeD1();
  db.activeUsers.add("user-1");
  await seedInvitation(db, { inviteeIdentifier: "person@example.test" });

  await assert.rejects(
    () =>
      redeemInvitation(asD1(db), {
        redeemToken: token,
        authenticatedUserId: "user-1",
        reason: "missing policy",
        now,
      }),
    (error: unknown) =>
      error instanceof InvitationRedeemError &&
      error.reasonCode === "invitee_identity_policy_required",
  );

  await assert.rejects(
    () =>
      redeemInvitation(
        asD1(db),
        {
          redeemToken: token,
          authenticatedUserId: "user-1",
          reason: "mismatch",
          now,
        },
        { matches: () => false },
      ),
    (error: unknown) =>
      error instanceof InvitationRedeemError && error.reasonCode === "invitee_identity_mismatch",
  );
});

test("same-role membership is accepted while different role is rejected", async () => {
  const sameRole = new FakeD1();
  sameRole.activeUsers.add("user-1");
  await seedInvitation(sameRole);
  sameRole.memberships.set("scope-1:user-1", {
    scopeId: "scope-1",
    userId: "user-1",
    role: "member",
  });

  const result = await redeemInvitation(asD1(sameRole), {
    redeemToken: token,
    authenticatedUserId: "user-1",
    reason: "already a member",
    now,
  });
  assert.equal(result.membershipKind, "already_exists");
  assert.equal(sameRole.invitations.get("invite-1")?.redeemedAt, now.toISOString());

  const differentRole = new FakeD1();
  differentRole.activeUsers.add("user-1");
  await seedInvitation(differentRole);
  differentRole.memberships.set("scope-1:user-1", {
    scopeId: "scope-1",
    userId: "user-1",
    role: "reviewer",
  });

  await assert.rejects(
    () =>
      redeemInvitation(asD1(differentRole), {
        redeemToken: token,
        authenticatedUserId: "user-1",
        reason: "wrong role",
        now,
      }),
    (error: unknown) =>
      error instanceof InvitationRedeemError && error.reasonCode === "membership_role_mismatch",
  );
  assert.equal(differentRole.invitations.get("invite-1")?.redeemedAt, null);
});

test("audit context contains no raw token or token hash", async () => {
  const db = new FakeD1();
  db.activeUsers.add("user-1");
  await seedInvitation(db);
  const result = await redeemInvitation(asD1(db), {
    redeemToken: token,
    authenticatedUserId: "user-1",
    reason: "accept invitation",
    now,
  });

  const audit = createInvitationRedeemAuditContext({
    requestContext: { requestId: "req-1", method: "POST", path: "/api/invitations/redeem" },
    result,
  });
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(await hashInvitationToken(token)), false);
  assert.equal(audit.event.action, "scope_invitation_redeem");
  assert.equal(audit.role, "member");
});
