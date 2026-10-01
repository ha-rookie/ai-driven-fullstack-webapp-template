import assert from "node:assert/strict";
import test from "node:test";

import {
  hashSessionToken,
  queryActiveApplicationSessionsForUser,
} from "../src/worker/auth";

interface FakeUser {
  status: "active" | "disabled";
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
        all: async <T>() => {
          if (!sql.includes("FROM application_sessions s JOIN users u")) {
            throw new Error(`Unsupported all query: ${sql}`);
          }

          const [userId, nowIso, idleCutoffIso, limit] = args as [
            string,
            string,
            string,
            number,
          ];
          const user = this.users.get(userId);
          if (!user || user.status !== "active") {
            return { results: [] as T[] };
          }

          const rows = [...this.sessions.entries()]
            .filter(([, session]) => session.userId === userId)
            .filter(([, session]) => session.revokedAt === null)
            .filter(([, session]) => session.expiresAt > nowIso)
            .filter(([, session]) => session.lastSeenAt > idleCutoffIso)
            .sort((left, right) => {
              const lastSeen = right[1].lastSeenAt.localeCompare(left[1].lastSeenAt);
              return lastSeen !== 0
                ? lastSeen
                : right[1].createdAt.localeCompare(left[1].createdAt);
            })
            .slice(0, limit)
            .map(([tokenHash, session]) => ({
              tokenHash,
              createdAt: session.createdAt,
              lastSeenAt: session.lastSeenAt,
              expiresAt: session.expiresAt,
            })) as T[];

          return { results: rows };
        },
      }),
    };
  }
}

const asD1 = (db: FakeD1) => db as unknown as D1Database;

const addSession = async (
  db: FakeD1,
  token: string,
  userId: string,
  options: Partial<FakeSession> = {},
) => {
  const tokenHash = await hashSessionToken(token);
  db.sessions.set(tokenHash, {
    userId,
    expiresAt: "2026-10-03T00:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    lastSeenAt: "2026-10-02T00:20:00.000Z",
    ...options,
  });
  return tokenHash;
};

test("returns only currently usable sessions and identifies the current session", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { status: "active" });
  fake.users.set("user-2", { status: "active" });

  const currentHash = await addSession(fake, "current-token", "user-1", {
    lastSeenAt: "2026-10-02T00:29:00.000Z",
  });
  await addSession(fake, "other-active-token", "user-1", {
    lastSeenAt: "2026-10-02T00:25:00.000Z",
  });
  await addSession(fake, "revoked-token", "user-1", {
    revokedAt: "2026-10-02T00:10:00.000Z",
  });
  await addSession(fake, "expired-token", "user-1", {
    expiresAt: "2026-10-01T23:59:59.000Z",
  });
  await addSession(fake, "idle-token", "user-1", {
    lastSeenAt: "2026-10-01T23:59:59.000Z",
  });
  await addSession(fake, "other-user-token", "user-2");

  const sessions = await queryActiveApplicationSessionsForUser(
    asD1(fake),
    "user-1",
    {
      now: new Date("2026-10-02T00:30:00.000Z"),
      currentSessionToken: "current-token",
    },
  );

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].current, true);
  assert.equal(sessions[1].current, false);
  assert.match(sessions[0].sessionId, /^sid_v1_/);
  assert.notEqual(sessions[0].sessionId, currentHash);
  assert.equal("tokenHash" in sessions[0], false);
  assert.equal("token" in sessions[0], false);
});

test("disabled users have no active sessions even if a physical session row remains", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { status: "disabled" });
  await addSession(fake, "lingering-token", "user-1");

  const sessions = await queryActiveApplicationSessionsForUser(
    asD1(fake),
    "user-1",
    { now: new Date("2026-10-02T00:30:00.000Z") },
  );

  assert.deepEqual(sessions, []);
});

test("applies deterministic ordering and bounded limit", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { status: "active" });
  await addSession(fake, "older-token", "user-1", {
    lastSeenAt: "2026-10-02T00:10:00.000Z",
  });
  await addSession(fake, "newer-token", "user-1", {
    lastSeenAt: "2026-10-02T00:20:00.000Z",
  });

  const sessions = await queryActiveApplicationSessionsForUser(
    asD1(fake),
    "user-1",
    {
      now: new Date("2026-10-02T00:30:00.000Z"),
      limit: 1,
      sessionPolicy: { idleTimeoutSeconds: 3600, touchIntervalSeconds: 300 },
    },
  );

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].lastSeenAt, "2026-10-02T00:20:00.000Z");
});

test("rejects invalid query bounds", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { status: "active" });

  await assert.rejects(
    () =>
      queryActiveApplicationSessionsForUser(asD1(fake), "user-1", {
        limit: 101,
      }),
    /Active session limit/,
  );

  await assert.rejects(
    () => queryActiveApplicationSessionsForUser(asD1(fake), " "),
    /User id is required/,
  );
});
