import test from "node:test";
import assert from "node:assert/strict";

import type { AuthProvider } from "../src/worker/auth";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSessionCookie,
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
}

class FakeD1 {
  readonly users = new Map<string, FakeUser>();
  readonly sessions = new Map<string, FakeSession>();

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          if (sql.startsWith("INSERT INTO application_sessions")) {
            const [tokenHash, userId, expiresAt, createdAt] = args as [
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
            });
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
            const [tokenHash, now] = args as [string, string];
            const session = this.sessions.get(tokenHash);
            if (
              !session ||
              session.revokedAt ||
              session.expiresAt <= now
            ) {
              return null;
            }

            const user = this.users.get(session.userId);
            if (!user) return null;

            return {
              user: {
                id: user.id,
                displayName: user.displayName,
              },
              expiresAt: session.expiresAt,
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

test("issued sessions store only the token hash", async () => {
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
});

test("valid session resolves the internal user", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: "User One" });
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 60,
  });

  const resolved = await resolveApplicationSession(
    sessionRequest(issued.token),
    asD1(fake),
    new Date("2026-01-01T00:00:30.000Z"),
  );

  assert.deepEqual(resolved, {
    user: { id: "user-1", displayName: "User One" },
    expiresAt: "2026-01-01T00:01:00.000Z",
  });
});

test("expired sessions are rejected", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: null });
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 60,
  });

  const resolved = await resolveApplicationSession(
    sessionRequest(issued.token),
    asD1(fake),
    new Date("2026-01-01T00:01:01.000Z"),
  );

  assert.equal(resolved, null);
});

test("revoked sessions are rejected", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { id: "user-1", displayName: null });
  const issued = await issueApplicationSession(asD1(fake), "user-1", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    ttlSeconds: 60,
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
