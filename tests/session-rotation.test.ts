import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_COOKIE_NAME,
  SessionRotationError,
  createSessionPolicy,
  hashSessionToken,
  resolveApplicationSession,
  rotateApplicationSession,
} from "../src/worker/auth";
import { issueCsrfTokenForRequest } from "../src/worker/http";

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

interface BoundStatement {
  sql: string;
  args: unknown[];
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result<unknown>>;
}

class FakeD1 {
  readonly users = new Map<string, FakeUser>();
  readonly sessions = new Map<string, FakeSession>();
  mutateBeforeBatch = false;
  private lastChanges = 0;

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => this.statement(sql, args),
    };
  }

  private statement(sql: string, args: unknown[]): BoundStatement {
    return {
      sql,
      args,
      first: async <T>() => {
        if (sql.includes("FROM application_sessions s") && sql.includes("JOIN users u")) {
          const [tokenHash] = args as [string];
          const session = this.sessions.get(tokenHash);
          if (!session || session.revokedAt) return null;
          const user = this.users.get(session.userId);
          if (!user) return null;

          if (sql.includes("s.user_id AS userId")) {
            return {
              userId: user.id,
              expiresAt: session.expiresAt,
              lastSeenAt: session.lastSeenAt,
            } as T;
          }

          return {
            id: user.id,
            displayName: user.displayName,
            expiresAt: session.expiresAt,
            lastSeenAt: session.lastSeenAt,
          } as T;
        }
        throw new Error(`Unsupported first query: ${sql}`);
      },
      run: async () => {
        throw new Error(`Unsupported standalone run query: ${sql}`);
      },
    };
  }

  async batch(statements: BoundStatement[]) {
    if (this.mutateBeforeBatch) {
      const update = statements[0];
      const currentHash = update.args[1] as string;
      const current = this.sessions.get(currentHash);
      if (current) current.lastSeenAt = "2026-01-01T00:02:01.000Z";
      this.mutateBeforeBatch = false;
    }

    const results: D1Result<unknown>[] = [];
    for (const statement of statements) {
      if (statement.sql.startsWith("UPDATE application_sessions")) {
        const [revokedAt, tokenHash, userId, expiresAt, lastSeenAt] = statement.args as [
          string,
          string,
          string,
          string,
          string,
        ];
        const session = this.sessions.get(tokenHash);
        const matches =
          !!session &&
          session.userId === userId &&
          session.revokedAt === null &&
          session.expiresAt === expiresAt &&
          session.lastSeenAt === lastSeenAt;
        if (matches && session) session.revokedAt = revokedAt;
        this.lastChanges = matches ? 1 : 0;
        results.push({ meta: { changes: this.lastChanges } } as D1Result<unknown>);
        continue;
      }

      if (statement.sql.startsWith("INSERT INTO application_sessions")) {
        const [tokenHash, userId, expiresAt, createdAt, lastSeenAt] = statement.args as [
          string,
          string,
          string,
          string,
          string,
        ];
        if (this.lastChanges === 1) {
          if (this.sessions.has(tokenHash)) throw new Error("token hash collision");
          this.sessions.set(tokenHash, {
            userId,
            expiresAt,
            revokedAt: null,
            createdAt,
            lastSeenAt,
          });
          this.lastChanges = 1;
        } else {
          this.lastChanges = 0;
        }
        results.push({ meta: { changes: this.lastChanges } } as D1Result<unknown>);
        continue;
      }

      throw new Error(`Unsupported batch query: ${statement.sql}`);
    }
    return results;
  }
}

const asD1 = (db: FakeD1) => db as unknown as D1Database;
const requestFor = (token: string) =>
  new Request("https://example.test/api/example", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
const tokenFromCookie = (cookie: string) => cookie.match(/^app_session=([^;]+)/)?.[1] ?? null;
const policy = createSessionPolicy({ idleTimeoutSeconds: 1800, touchIntervalSeconds: 300 });

const seed = async (
  fake: FakeD1,
  token: string,
  input: Partial<FakeSession> = {},
) => {
  fake.users.set("user-1", { id: "user-1", displayName: "User One" });
  const tokenHash = await hashSessionToken(token);
  fake.sessions.set(tokenHash, {
    userId: "user-1",
    expiresAt: "2026-01-01T01:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    ...input,
  });
  return tokenHash;
};

test("rotation revokes the old session and issues a hashed replacement without extending absolute expiry", async () => {
  const fake = new FakeD1();
  const oldToken = "old-session-token";
  const oldHash = await seed(fake, oldToken);
  const now = new Date("2026-01-01T00:02:00.000Z");

  const rotated = await rotateApplicationSession(requestFor(oldToken), asD1(fake), now, policy);
  const newToken = tokenFromCookie(rotated.setCookie);
  assert.ok(newToken);
  const newHash = await hashSessionToken(newToken);

  assert.equal(rotated.userId, "user-1");
  assert.equal(rotated.expiresAt, "2026-01-01T01:00:00.000Z");
  assert.equal(fake.sessions.get(oldHash)?.revokedAt, now.toISOString());
  assert.equal(fake.sessions.has(newToken), false);
  assert.equal(fake.sessions.has(newHash), true);
  assert.equal(fake.sessions.get(newHash)?.expiresAt, rotated.expiresAt);
  assert.equal(fake.sessions.get(newHash)?.lastSeenAt, now.toISOString());
  assert.match(rotated.setCookie, /HttpOnly/);
  assert.match(rotated.setCookie, /Secure/);
  assert.match(rotated.setCookie, /SameSite=Lax/);
  assert.match(rotated.setCookie, /Max-Age=3480/);

  assert.equal(
    await resolveApplicationSession(requestFor(oldToken), asD1(fake), now, policy),
    null,
  );
  assert.deepEqual(
    await resolveApplicationSession(
      requestFor(newToken),
      asD1(fake),
      new Date("2026-01-01T00:02:01.000Z"),
      policy,
    ),
    {
      user: { id: "user-1", displayName: "User One" },
      expiresAt: "2026-01-01T01:00:00.000Z",
    },
  );
});

test("rotation rejects missing, expired, idle-expired, and revoked sessions", async () => {
  const missing = new FakeD1();
  await assert.rejects(
    rotateApplicationSession(new Request("https://example.test"), asD1(missing)),
    (error: unknown) => error instanceof SessionRotationError && error.reason === "session_missing_or_invalid",
  );

  for (const session of [
    { expiresAt: "2026-01-01T00:01:00.000Z" },
    { lastSeenAt: "2025-12-31T23:30:00.000Z" },
    { revokedAt: "2026-01-01T00:00:30.000Z" },
  ]) {
    const fake = new FakeD1();
    const token = crypto.randomUUID();
    await seed(fake, token, session);
    await assert.rejects(
      rotateApplicationSession(
        requestFor(token),
        asD1(fake),
        new Date("2026-01-01T00:31:00.000Z"),
        policy,
      ),
      (error: unknown) => error instanceof SessionRotationError && error.reason === "session_missing_or_invalid",
    );
  }
});

test("concurrent session state change fails closed without issuing a replacement", async () => {
  const fake = new FakeD1();
  const token = "concurrent-session-token";
  const oldHash = await seed(fake, token);
  fake.mutateBeforeBatch = true;

  await assert.rejects(
    rotateApplicationSession(
      requestFor(token),
      asD1(fake),
      new Date("2026-01-01T00:02:00.000Z"),
      policy,
    ),
    (error: unknown) => error instanceof SessionRotationError && error.reason === "session_state_changed",
  );

  assert.equal(fake.sessions.get(oldHash)?.revokedAt, null);
  assert.equal(fake.sessions.size, 1);
});

test("rotation changes the session-bound CSRF proof", async () => {
  const fake = new FakeD1();
  const oldToken = "csrf-old-session-token";
  await seed(fake, oldToken);
  const oldRequest = requestFor(oldToken);
  const oldProof = await issueCsrfTokenForRequest(oldRequest);

  const rotated = await rotateApplicationSession(
    oldRequest,
    asD1(fake),
    new Date("2026-01-01T00:02:00.000Z"),
    policy,
  );
  const newToken = tokenFromCookie(rotated.setCookie);
  assert.ok(newToken);
  const newProof = await issueCsrfTokenForRequest(requestFor(newToken));

  assert.ok(oldProof);
  assert.ok(newProof);
  assert.notEqual(newProof, oldProof);
});
