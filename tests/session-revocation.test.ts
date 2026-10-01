import assert from "node:assert/strict";
import test from "node:test";

import {
  SessionRevocationCurrentSessionError,
  hashSessionToken,
  resolveSessionToken,
  revokeAllApplicationSessionsForUser,
  revokeOtherApplicationSessionsForUser,
} from "../src/worker/auth";

interface FakeUser {
  id: string;
  displayName: string | null;
}

interface FakeSession {
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
}

class FakeD1 {
  readonly users = new Map<string, FakeUser>();
  readonly sessions = new Map<string, FakeSession>();

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (
            sql ===
            "UPDATE application_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL"
          ) {
            const [revokedAt, userId] = args as [string, string];
            let changes = 0;
            for (const session of this.sessions.values()) {
              if (session.userId === userId && session.revokedAt === null) {
                session.revokedAt = revokedAt;
                changes += 1;
              }
            }
            return { meta: { changes } };
          }

          if (
            sql ===
            "UPDATE application_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND token_hash<>?"
          ) {
            const [revokedAt, userId, excludedTokenHash] = args as [
              string,
              string,
              string,
            ];
            let changes = 0;
            for (const [tokenHash, session] of this.sessions.entries()) {
              if (
                session.userId === userId &&
                session.revokedAt === null &&
                tokenHash !== excludedTokenHash
              ) {
                session.revokedAt = revokedAt;
                changes += 1;
              }
            }
            return { meta: { changes } };
          }

          if (sql.startsWith("UPDATE application_sessions SET last_seen_at=")) {
            return { meta: { changes: 0 } };
          }

          throw new Error(`Unsupported run query: ${sql}`);
        },
        first: async <T>() => {
          if (
            sql ===
            "SELECT user_id AS userId FROM application_sessions WHERE token_hash=? AND revoked_at IS NULL"
          ) {
            const [tokenHash] = args as [string];
            const session = this.sessions.get(tokenHash);
            return (session && session.revokedAt === null
              ? { userId: session.userId }
              : null) as T | null;
          }

          if (sql.includes("FROM application_sessions s JOIN users u")) {
            const [tokenHash] = args as [string];
            const session = this.sessions.get(tokenHash);
            if (!session || session.revokedAt !== null) return null;
            const user = this.users.get(session.userId);
            if (!user) return null;
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

const sessionRequest = (token: string) =>
  new Request("https://example.test/api/admin/session-revocation", {
    headers: { cookie: `app_session=${token}` },
  });

const addSession = async (
  db: FakeD1,
  token: string,
  userId: string,
  options: Partial<FakeSession> = {},
) => {
  const tokenHash = await hashSessionToken(token);
  db.sessions.set(tokenHash, {
    userId,
    expiresAt: "2099-01-01T00:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:20:00.000Z",
    ...options,
  });
  return tokenHash;
};

test("revoke all durably revokes every non-revoked session for the target user", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: "User One" });
  fake.users.set("user-2", { id: "user-2", displayName: "User Two" });

  const activeHash = await addSession(fake, "active-token", "user-1");
  const expiredHash = await addSession(fake, "expired-token", "user-1", {
    expiresAt: "2025-01-01T00:00:00.000Z",
  });
  const idleExpiredHash = await addSession(fake, "idle-token", "user-1", {
    lastSeenAt: "2025-01-01T00:00:00.000Z",
  });
  const alreadyRevokedHash = await addSession(fake, "revoked-token", "user-1", {
    revokedAt: "2026-01-01T00:10:00.000Z",
  });
  const otherUserHash = await addSession(fake, "other-token", "user-2");

  const result = await revokeAllApplicationSessionsForUser(
    asD1(fake),
    "user-1",
    new Date("2026-01-01T00:30:00.000Z"),
  );

  assert.deepEqual(result, {
    userId: "user-1",
    mode: "all",
    revokedCount: 3,
  });
  assert.equal(fake.sessions.get(activeHash)?.revokedAt, "2026-01-01T00:30:00.000Z");
  assert.equal(fake.sessions.get(expiredHash)?.revokedAt, "2026-01-01T00:30:00.000Z");
  assert.equal(fake.sessions.get(idleExpiredHash)?.revokedAt, "2026-01-01T00:30:00.000Z");
  assert.equal(fake.sessions.get(alreadyRevokedHash)?.revokedAt, "2026-01-01T00:10:00.000Z");
  assert.equal(fake.sessions.get(otherUserHash)?.revokedAt, null);

  assert.equal(
    await resolveSessionToken(
      "active-token",
      asD1(fake),
      new Date("2026-01-01T00:30:00.000Z"),
    ),
    null,
  );
});

test("revoke all is idempotent and returns zero after the first operation", async () => {
  const fake = new FakeD1();
  await addSession(fake, "session-a", "user-1");
  await addSession(fake, "session-b", "user-1");

  const first = await revokeAllApplicationSessionsForUser(
    asD1(fake),
    "user-1",
    new Date("2026-01-01T00:30:00.000Z"),
  );
  const second = await revokeAllApplicationSessionsForUser(
    asD1(fake),
    "user-1",
    new Date("2026-01-01T00:31:00.000Z"),
  );

  assert.equal(first.revokedCount, 2);
  assert.equal(second.revokedCount, 0);
});

test("revoke others preserves the authenticated user's current session", async () => {
  const fake = new FakeD1();
  const currentHash = await addSession(fake, "current-token", "user-1");
  const otherAHash = await addSession(fake, "other-a", "user-1");
  const otherBHash = await addSession(fake, "other-b", "user-1");
  const otherUserHash = await addSession(fake, "other-user", "user-2");

  const result = await revokeOtherApplicationSessionsForUser(
    sessionRequest("current-token"),
    asD1(fake),
    "user-1",
    new Date("2026-01-01T00:30:00.000Z"),
  );

  assert.deepEqual(result, {
    userId: "user-1",
    mode: "others",
    revokedCount: 2,
  });
  assert.equal(fake.sessions.get(currentHash)?.revokedAt, null);
  assert.equal(fake.sessions.get(otherAHash)?.revokedAt, "2026-01-01T00:30:00.000Z");
  assert.equal(fake.sessions.get(otherBHash)?.revokedAt, "2026-01-01T00:30:00.000Z");
  assert.equal(fake.sessions.get(otherUserHash)?.revokedAt, null);
});

test("revoke others fails closed when the current session belongs to another user", async () => {
  const fake = new FakeD1();
  await addSession(fake, "wrong-current", "user-2");
  const targetAHash = await addSession(fake, "target-a", "user-1");
  const targetBHash = await addSession(fake, "target-b", "user-1");

  await assert.rejects(
    () =>
      revokeOtherApplicationSessionsForUser(
        sessionRequest("wrong-current"),
        asD1(fake),
        "user-1",
        new Date("2026-01-01T00:30:00.000Z"),
      ),
    SessionRevocationCurrentSessionError,
  );

  assert.equal(fake.sessions.get(targetAHash)?.revokedAt, null);
  assert.equal(fake.sessions.get(targetBHash)?.revokedAt, null);
});

test("revoke others fails closed when there is no current session cookie", async () => {
  const fake = new FakeD1();
  const targetHash = await addSession(fake, "target-a", "user-1");

  await assert.rejects(
    () =>
      revokeOtherApplicationSessionsForUser(
        new Request("https://example.test/api/admin/session-revocation"),
        asD1(fake),
        "user-1",
      ),
    SessionRevocationCurrentSessionError,
  );

  assert.equal(fake.sessions.get(targetHash)?.revokedAt, null);
});
