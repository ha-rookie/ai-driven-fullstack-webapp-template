import assert from "node:assert/strict";
import test from "node:test";

import {
  InvitationError,
  findInvitationById,
  hashInvitationToken,
  issueInvitation,
  revokeInvitation,
  type InvitationRolePolicy,
} from "../src/worker/administration";
import {
  createInvitationIssuedAuditContext,
  createInvitationRevokedAuditContext,
} from "../src/worker/audit";

interface FakeInvitation {
  id: string;
  tokenHash: string;
  scopeId: string;
  inviteeIdentifier: string | null;
  intendedRole: string;
  issuedBy: string;
  issuedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

class FakeD1 {
  readonly scopes = new Set<string>();
  readonly invitations = new Map<string, FakeInvitation>();

  private row(value: FakeInvitation) {
    return {
      id: value.id,
      scopeId: value.scopeId,
      inviteeIdentifier: value.inviteeIdentifier,
      intendedRole: value.intendedRole,
      issuedBy: value.issuedBy,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
      redeemedAt: value.redeemedAt,
      revokedAt: value.revokedAt,
    };
  }

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        first: async <T>() => {
          if (sql === "SELECT id FROM resource_scopes WHERE id=?") {
            const [id] = args as [string];
            return (this.scopes.has(id) ? { id } : null) as T | null;
          }

          if (sql.includes("FROM scope_invitations WHERE id=?")) {
            const [id] = args as [string];
            const found = this.invitations.get(id);
            return (found ? this.row(found) : null) as T | null;
          }

          if (sql.includes("FROM scope_invitations") && sql.includes("LIMIT 1")) {
            const [scopeId, nullIdentifier, inviteeIdentifier, intendedRole, nowIso] = args as [
              string,
              string | null,
              string | null,
              string,
              string,
            ];
            const wantedIdentifier = nullIdentifier === null ? null : inviteeIdentifier;
            const found = [...this.invitations.values()].find(
              (row) =>
                row.scopeId === scopeId &&
                row.inviteeIdentifier === wantedIdentifier &&
                row.intendedRole === intendedRole &&
                row.revokedAt === null &&
                row.redeemedAt === null &&
                row.expiresAt > nowIso,
            );
            return (found ? this.row(found) : null) as T | null;
          }

          throw new Error(`Unsupported first query: ${sql}`);
        },
        run: async () => {
          if (sql.startsWith("INSERT INTO scope_invitations")) {
            const [
              id,
              tokenHash,
              scopeId,
              inviteeIdentifier,
              intendedRole,
              issuedBy,
              issuedAt,
              expiresAt,
            ] = args as [string, string, string, string | null, string, string, string, string];
            this.invitations.set(id, {
              id,
              tokenHash,
              scopeId,
              inviteeIdentifier,
              intendedRole,
              issuedBy,
              issuedAt,
              expiresAt,
              redeemedAt: null,
              revokedAt: null,
            });
            return { meta: { changes: 1 } };
          }

          if (sql.startsWith("UPDATE scope_invitations") && sql.includes("SET revoked_at=?")) {
            const [revokedAt, id, cutoff] = args as [string, string, string];
            const row = this.invitations.get(id);
            if (
              !row ||
              row.revokedAt !== null ||
              row.redeemedAt !== null ||
              row.expiresAt <= cutoff
            ) {
              return { meta: { changes: 0 } };
            }
            row.revokedAt = revokedAt;
            return { meta: { changes: 1 } };
          }

          throw new Error(`Unsupported run query: ${sql}`);
        },
      }),
    };
  }
}

const asD1 = (db: FakeD1) => db as unknown as D1Database;
const rolePolicy: InvitationRolePolicy = {
  isAllowed: (role) => ["member", "reviewer"].includes(role),
};
const now = new Date("2026-10-02T00:00:00.000Z");

test("issue invitation returns raw token once while storage keeps only its hash", async () => {
  const fake = new FakeD1();
  fake.scopes.add("scope-1");

  const result = await issueInvitation(
    asD1(fake),
    {
      actorId: "operator-1",
      scopeId: "scope-1",
      intendedRole: "reviewer",
      inviteeIdentifier: "user@example.test",
      reason: "invite reviewer",
      now,
      ttlSeconds: 3600,
    },
    rolePolicy,
  );

  assert.equal(result.invitation.state, "open");
  assert.equal(result.invitation.intendedRole, "reviewer");
  assert.ok(result.redeemToken.length >= 40);

  const stored = fake.invitations.get(result.invitation.id);
  assert.ok(stored);
  assert.notEqual(stored.tokenHash, result.redeemToken);
  assert.equal(stored.tokenHash, await hashInvitationToken(result.redeemToken));
  assert.equal(JSON.stringify(stored).includes(result.redeemToken), false);

  const audit = createInvitationIssuedAuditContext(
    { requestId: "req-1", method: "POST", path: "/api/admin/invitations" },
    result,
  );
  assert.equal(audit.intendedRole, "reviewer");
  assert.equal(JSON.stringify(audit).includes(result.redeemToken), false);
});

test("duplicate open invitation is rejected but expired invitation does not block reissue", async () => {
  const fake = new FakeD1();
  fake.scopes.add("scope-1");
  const input = {
    actorId: "operator-1",
    scopeId: "scope-1",
    intendedRole: "member",
    inviteeIdentifier: "same@example.test",
    reason: "invite member",
    now,
    ttlSeconds: 3600,
  };

  const first = await issueInvitation(asD1(fake), input, rolePolicy);
  await assert.rejects(
    () => issueInvitation(asD1(fake), input, rolePolicy),
    (error: unknown) =>
      error instanceof InvitationError && error.reasonCode === "invitation_already_open",
  );

  const stored = fake.invitations.get(first.invitation.id);
  assert.ok(stored);
  stored.expiresAt = "2026-10-01T23:59:59.000Z";

  const reissued = await issueInvitation(asD1(fake), input, rolePolicy);
  assert.notEqual(reissued.invitation.id, first.invitation.id);
});

test("project role policy and scope existence fail closed", async () => {
  const fake = new FakeD1();

  await assert.rejects(
    () =>
      issueInvitation(
        asD1(fake),
        {
          actorId: "operator-1",
          scopeId: "missing",
          intendedRole: "member",
          reason: "invite",
          now,
        },
        rolePolicy,
      ),
    (error: unknown) => error instanceof InvitationError && error.reasonCode === "scope_not_found",
  );

  fake.scopes.add("scope-1");
  await assert.rejects(
    () =>
      issueInvitation(
        asD1(fake),
        {
          actorId: "operator-1",
          scopeId: "scope-1",
          intendedRole: "owner",
          reason: "invite",
          now,
        },
        rolePolicy,
      ),
    (error: unknown) => error instanceof InvitationError && error.reasonCode === "invalid_role",
  );
});

test("invitation state distinguishes open, expired, redeemed and revoked", async () => {
  const fake = new FakeD1();
  fake.scopes.add("scope-1");
  const issued = await issueInvitation(
    asD1(fake),
    {
      actorId: "operator-1",
      scopeId: "scope-1",
      intendedRole: "member",
      reason: "invite",
      now,
      ttlSeconds: 3600,
    },
    rolePolicy,
  );
  const stored = fake.invitations.get(issued.invitation.id)!;

  assert.equal((await findInvitationById(asD1(fake), stored.id, now))?.state, "open");
  assert.equal(
    (await findInvitationById(asD1(fake), stored.id, new Date("2026-10-02T02:00:00.000Z")))?.state,
    "expired",
  );

  stored.redeemedAt = "2026-10-02T00:10:00.000Z";
  assert.equal((await findInvitationById(asD1(fake), stored.id, now))?.state, "redeemed");
  stored.redeemedAt = null;
  stored.revokedAt = "2026-10-02T00:10:00.000Z";
  assert.equal((await findInvitationById(asD1(fake), stored.id, now))?.state, "revoked");
});

test("revoke changes only an open invitation and produces token-free audit context", async () => {
  const fake = new FakeD1();
  fake.scopes.add("scope-1");
  const issued = await issueInvitation(
    asD1(fake),
    {
      actorId: "operator-1",
      scopeId: "scope-1",
      intendedRole: "member",
      reason: "invite",
      now,
      ttlSeconds: 3600,
    },
    rolePolicy,
  );

  const revoked = await revokeInvitation(asD1(fake), {
    actorId: "operator-2",
    invitationId: issued.invitation.id,
    reason: "invitation no longer required",
    now: new Date("2026-10-02T00:10:00.000Z"),
  });

  assert.equal(revoked.invitation.state, "revoked");
  assert.equal(revoked.actorId, "operator-2");
  const audit = createInvitationRevokedAuditContext(
    { requestId: "req-2", method: "DELETE", path: "/api/admin/invitations/id" },
    revoked,
  );
  assert.equal(audit.event.action, "scope_invitation_revoke");
  assert.equal(JSON.stringify(audit).includes(issued.redeemToken), false);

  await assert.rejects(
    () =>
      revokeInvitation(asD1(fake), {
        actorId: "operator-2",
        invitationId: issued.invitation.id,
        reason: "again",
        now: new Date("2026-10-02T00:20:00.000Z"),
      }),
    (error: unknown) => error instanceof InvitationError && error.reasonCode === "invitation_not_open",
  );
});
