import test from "node:test";
import assert from "node:assert/strict";

import type { AuthProvider } from "../src/worker/auth";
import {
  SESSION_COOKIE_NAME,
  SessionPolicyConfigurationError,
  clearSessionCookie,
  createSessionCookie,
  createSessionPolicy,
  hashSessionToken,
  issueApplicationSession,
  resolveApplicationSession,
  revokeApplicationSession,
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
  lastSeenAt: string | null;
}

class FakeD1 {
  readonly users = new Map<string, FakeUser>();
  readonly sessions = new Map<string, FakeSession>();
  touchUpdates = 0;
  concurrentTouchAt: string | null = null;

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

          if (sql.startsWith("UPDATE application_sessions SET last_seen_at")) {
            const [nextLastSeenAt, tokenHash, expiresAfter, expectedLastSeenAt] =
              args as [string, string, string, string];
            const session = this.sessions.get(tokenHash);

            if (session && this.concurrentTouchAt) {
              session.lastSeenAt = this.concurrentTouchAt;
              this.concurrentTouchAt = null;
            }

            if (
              !session ||
              session.revokedAt ||
              session.expiresAt <= expiresAfter ||
              session.lastSeenAt !== expectedLastSeenAt
            ) {
              return { meta: { changes: 0 } };
            }

            session.lastSeenAt = nextLastSeenAt;
            this.touchUpdates += 1;
            return { meta: { changes: 1 } };
          }

          if (sql.startsWith("UPDATE application_sessions SET revoked_at")) {
            const [revokedAt, tokenHash] = args as [string, string];
            const session = this.sessions.get(tokenHash);
            if (!session || session.revokedAt) {
              return { meta: { changes: 0 } };
            }
            session.revokedAt = revokedAt;
            return { meta: { changes: 1 } };
          }

          throw new Error(`Unsupported run query: ${sql}`);
        },
        first: async <T>() => {
          if (sql.includes("FROM application_sessions s JOIN users u")) {
            const [tokenHash] = args as [string];
            const session = this.sessions.get(tokenHash);
            if (!session || session.revokedAt) return null;

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
  new Request("https://example.test/api/auth/me", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });

const policy = createSessionPolicy({
  idleTimeoutSeconds: 30 * 60,
  touchIntervalSeconds: 5 * 60,
});

test("AuthProvider contract is provider-agnostic", async () => {
  const provider: AuthProvider<string> = {
    provider: "example",
    async verify(credential) {
      return {
        provider: this.provider,
        subject: credential,
        displayName: "Example User",
      };
    },
  };

  assert.deepEqual(await provider.verify("subject-1"), {
    provider: "example",
    subject: "subject-1",
    displayName: "Example User",
  });
});

test("session policy uses bounded defaults and validates overrides", () => {
  assert.deepEqual(createSessionPolicy(), {
    idleTimeoutSeconds: 1800,
    touchIntervalSeconds: 300,
  });
  assert.deepEqual(
    createSessionPolicy({ idleTimeoutSeconds: "900", touchIntervalSeconds: "60" }),
    { idleTimeoutSeconds: 900, touchIntervalSeconds: 60 },
  );
  assert.throws(
    () => createSessionPolicy({ idleTimeoutSeconds: "invalid" }),
    SessionPolicyConfigurationError,
  );
  assert.throws(
    () => createSessionPolicy({ idleTimeoutSeconds: 300, touchIntervalSeconds: 300 }),
    SessionPolicyConfigurationError,
  );
});

test("issued sessions store only the token hash and initialize last_seen_at", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: "User One" });
  const now = new Date("2026-01-01T00:00:00.000Z");

  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now,
    ttlSeconds: 60,
  });
  const tokenHash = await hashSessionToken(issued.token);

  assert.equal(issued.token.length, 43);
  assert.notEqual(issued.token, tokenHash);
  assert.equal(fake.sessions.has(tokenHash), true);
  assert.equal(fake.sessions.has(issued.token), false);
  assert.equal(issued.expiresAt, "2026-01-01T00:01:00.000Z");
  assert.equal(fake.sessions.get(tokenHash)?.lastSeenAt, now.toISOString());
});

test("active session resolves without a D1 touch before the coalescing interval", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: "User One" });
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 3600,
  });

  const resolved = await resolveApplicationSession(
    sessionRequest(issued.token),
    asD1(fake),
    new Date("2026-01-01T00:04:59.000Z"),
    policy,
  );

  assert.deepEqual(resolved, {
    user: { id: "user-1", displayName: "User One" },
    expiresAt: "2026-01-01T01:00:00.000Z",
  });
  assert.equal(fake.touchUpdates, 0);
});

test("active session is conditionally touched after the coalescing interval", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: "User One" });
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 3600,
  });
  const tokenHash = await hashSessionToken(issued.token);

  const resolved = await resolveApplicationSession(
    sessionRequest(issued.token),
    asD1(fake),
    new Date("2026-01-01T00:05:00.000Z"),
    policy,
  );

  assert.ok(resolved);
  assert.equal(fake.touchUpdates, 1);
  assert.equal(
    fake.sessions.get(tokenHash)?.lastSeenAt,
    "2026-01-01T00:05:00.000Z",
  );
});

test("idle timeout rejects a session at the configured boundary", async () => {
  const create = async () => {
    const fake = new FakeD1();
    fake.users.set("user-1", { id: "user-1", displayName: null });
    const issued = await issueApplicationSession(asD1(fake), "user-1", {
      now: new Date("2026-01-01T00:00:00.000Z"),
      ttlSeconds: 7200,
    });
    return { fake, issued };
  };

  const before = await create();
  assert.ok(
    await resolveApplicationSession(
      sessionRequest(before.issued.token),
      asD1(before.fake),
      new Date("2026-01-01T00:29:59.000Z"),
      policy,
    ),
  );

  const atBoundary = await create();
  assert.equal(
    await resolveApplicationSession(
      sessionRequest(atBoundary.issued.token),
      asD1(atBoundary.fake),
      new Date("2026-01-01T00:30:00.000Z"),
      policy,
    ),
    null,
  );
  assert.equal(atBoundary.fake.touchUpdates, 0);
});

test("absolute expiry wins even when last_seen_at is recent", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: null });
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 60,
  });
  const tokenHash = await hashSessionToken(issued.token);
  const session = fake.sessions.get(tokenHash);
  assert.ok(session);
  session.lastSeenAt = "2026-01-01T00:00:59.000Z";

  assert.equal(
    await resolveApplicationSession(
      sessionRequest(issued.token),
      asD1(fake),
      new Date("2026-01-01T00:01:00.000Z"),
      policy,
    ),
    null,
  );
});

test("stale concurrent touches cannot move last_seen_at backwards", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: null });
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 3600,
  });
  const tokenHash = await hashSessionToken(issued.token);
  fake.concurrentTouchAt = "2026-01-01T00:05:01.000Z";

  assert.ok(
    await resolveApplicationSession(
      sessionRequest(issued.token),
      asD1(fake),
      new Date("2026-01-01T00:05:00.000Z"),
      policy,
    ),
  );
  assert.equal(fake.touchUpdates, 0);
  assert.equal(
    fake.sessions.get(tokenHash)?.lastSeenAt,
    "2026-01-01T00:05:01.000Z",
  );
});

test("revoked sessions are rejected", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: null });
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 3600,
  });
  const request = sessionRequest(issued.token);

  assert.equal(
    await revokeApplicationSession(
      request,
      asD1(fake),
      new Date("2026-01-01T00:00:20.000Z"),
    ),
    true,
  );

  assert.equal(
    await resolveApplicationSession(
      request,
      asD1(fake),
      new Date("2026-01-01T00:00:30.000Z"),
      policy,
    ),
    null,
  );
});

test("session cookies use secure browser attributes", () => {
  const cookie = createSessionCookie("token", 120);
  assert.match(cookie, /^app_session=token;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=120/);

  const cleared = clearSessionCookie();
  assert.match(cleared, /^app_session=;/);
  assert.match(cleared, /Max-Age=0/);
});
