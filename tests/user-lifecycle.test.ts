import test from "node:test";
import assert from "node:assert/strict";

import {
  disableUser,
  hashSessionToken,
  issueApplicationSession,
  reactivateUser,
  resolveActiveUserForExternalIdentity,
  resolveSessionToken,
  UserLifecycleTransitionError,
  type UserStatus,
} from "../src/worker/auth";
import { createUserLifecycleAuditEvent } from "../src/worker/audit";

interface FakeUser {
  id: string;
  displayName: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

interface FakeSession {
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

class FakeD1 {
  readonly users = new Map<string, FakeUser>();
  readonly identities = new Map<string, string>();
  readonly sessions = new Map<string, FakeSession>();
  failRevocation = false;

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.startsWith("INSERT INTO application_sessions")) {
            const [tokenHash, userId, expiresAt, createdAt, lastSeenAt] = args as [
              string,
              string,
              string,
              string,
              string,
            ];
            this.sessions.set(tokenHash, {
              userId,
              expiresAt,
              revokedAt: null,
              createdAt,
              lastSeenAt,
            });
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET status='disabled'")) {
            const [updatedAt, userId] = args as [string, string];
            const user = this.users.get(userId);
            if (!user || user.status !== "active") return { meta: { changes: 0 } };
            user.status = "disabled";
            user.updatedAt = updatedAt;
            return { meta: { changes: 1 } };
          }

          if (sql.includes("SET status='active'")) {
            const [updatedAt, userId] = args as [string, string];
            const user = this.users.get(userId);
            if (!user || user.status !== "disabled") return { meta: { changes: 0 } };
            user.status = "active";
            user.updatedAt = updatedAt;
            return { meta: { changes: 1 } };
          }

          if (
            sql.startsWith("UPDATE application_sessions SET revoked_at") &&
            sql.includes("WHERE user_id=?")
          ) {
            if (this.failRevocation) throw new Error("revocation unavailable");
            const [revokedAt, userId] = args as [string, string];
            let changes = 0;
            for (const session of this.sessions.values()) {
              if (session.userId === userId && !session.revokedAt) {
                session.revokedAt = revokedAt;
                changes += 1;
              }
            }
            return { meta: { changes } };
          }

          throw new Error(`Unsupported run query: ${sql}`);
        },
        first: async <T>() => {
          if (sql.includes("FROM external_identities e JOIN users u")) {
            const [provider, subject] = args as [string, string];
            const userId = this.identities.get(`${provider}:${subject}`);
            const user = userId ? this.users.get(userId) : undefined;
            if (!user) return null;
            return { ...user } as T;
          }

          if (sql.includes("FROM application_sessions s JOIN users u")) {
            const [tokenHash] = args as [string];
            const session = this.sessions.get(tokenHash);
            if (!session || session.revokedAt) return null;
            const user = this.users.get(session.userId);
            if (!user || user.status !== "active") return null;
            return {
              id: user.id,
              displayName: user.displayName,
              expiresAt: session.expiresAt,
              lastSeenAt: session.lastSeenAt,
            } as T;
          }

          throw new Error(`Unsupported first query: ${sql}`);
        },
      }),
    };
  }
}

const asD1 = (db: FakeD1) => db as unknown as D1Database;

const seedUser = (db: FakeD1) => {
  db.users.set("user-1", {
    id: "user-1",
    displayName: "User One",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  db.identities.set("oidc:subject-1", "user-1");
};

test("active external identity resolves to an Internal User", async () => {
  const fake = new FakeD1();
  seedUser(fake);

  const user = await resolveActiveUserForExternalIdentity(asD1(fake), {
    provider: "oidc",
    subject: "subject-1",
  });

  assert.equal(user?.id, "user-1");
  assert.equal(user?.status, "active");
});

test("disable revokes existing sessions and rejects authentication", async () => {
  const fake = new FakeD1();
  seedUser(fake);
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 3600,
  });

  const before = await resolveSessionToken(
    issued.token,
    asD1(fake),
    new Date("2026-01-01T00:01:00.000Z"),
  );
  assert.equal(before?.user.id, "user-1");

  const result = await disableUser(asD1(fake), "user-1", {
    actorId: "admin-1",
    reason: "employment ended",
    now: new Date("2026-01-01T00:02:00.000Z"),
  });

  assert.equal(result.nextStatus, "disabled");
  assert.equal(result.revokedSessionCount, 1);
  assert.equal(fake.users.get("user-1")?.status, "disabled");
  assert.equal(
    await resolveSessionToken(
      issued.token,
      asD1(fake),
      new Date("2026-01-01T00:03:00.000Z"),
    ),
    null,
  );
  assert.equal(
    await resolveActiveUserForExternalIdentity(asD1(fake), {
      provider: "oidc",
      subject: "subject-1",
    }),
    null,
  );
});

test("disable remains fail closed when session revocation fails", async () => {
  const fake = new FakeD1();
  seedUser(fake);
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 3600,
  });
  fake.failRevocation = true;

  await assert.rejects(
    disableUser(asD1(fake), "user-1", {
      actorId: "admin-1",
      reason: "security response",
      now: new Date("2026-01-01T00:02:00.000Z"),
    }),
    /revocation unavailable/,
  );

  assert.equal(fake.users.get("user-1")?.status, "disabled");
  const tokenHash = await hashSessionToken(issued.token);
  assert.equal(fake.sessions.get(tokenHash)?.revokedAt, null);
  assert.equal(
    await resolveSessionToken(
      issued.token,
      asD1(fake),
      new Date("2026-01-01T00:03:00.000Z"),
    ),
    null,
  );
});

test("reactivate permits a new authentication flow without reviving old sessions", async () => {
  const fake = new FakeD1();
  seedUser(fake);
  const oldSession = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 3600,
  });

  await disableUser(asD1(fake), "user-1", {
    actorId: "admin-1",
    reason: "temporary hold",
    now: new Date("2026-01-01T00:01:00.000Z"),
  });
  const result = await reactivateUser(asD1(fake), "user-1", {
    actorId: "admin-2",
    reason: "review completed",
    now: new Date("2026-01-01T00:02:00.000Z"),
  });

  assert.equal(result.nextStatus, "active");
  assert.equal(
    await resolveSessionToken(
      oldSession.token,
      asD1(fake),
      new Date("2026-01-01T00:03:00.000Z"),
    ),
    null,
  );

  const user = await resolveActiveUserForExternalIdentity(asD1(fake), {
    provider: "oidc",
    subject: "subject-1",
  });
  assert.equal(user?.status, "active");

  const newSession = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:03:00.000Z"),
    ttlSeconds: 3600,
  });
  assert.equal(
    (
      await resolveSessionToken(
        newSession.token,
        asD1(fake),
        new Date("2026-01-01T00:04:00.000Z"),
      )
    )?.user.id,
    "user-1",
  );
});

test("lifecycle context is bounded and maps to Audit", async () => {
  const fake = new FakeD1();
  seedUser(fake);

  await assert.rejects(
    disableUser(asD1(fake), "user-1", {
      actorId: "admin-1",
      reason: "x".repeat(201),
    }),
    UserLifecycleTransitionError,
  );

  const result = await disableUser(asD1(fake), "user-1", {
    actorId: "admin-1",
    reason: "access no longer required",
    now: new Date("2026-01-01T00:05:00.000Z"),
  });
  const event = createUserLifecycleAuditEvent({
    requestContext: {
      requestId: "req-1",
      method: "POST",
      path: "/admin/users/user-1/disable",
    },
    result,
  });

  assert.deepEqual(event, {
    requestId: "req-1",
    method: "POST",
    path: "/admin/users/user-1/disable",
    category: "authentication",
    action: "user_disable",
    outcome: "success",
    actorId: "admin-1",
    resourceType: "user",
    resourceId: "user-1",
    reason: "access no longer required",
    affectedCount: 0,
  });
});
