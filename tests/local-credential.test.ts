import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalCredentialMutationError,
  LocalCredentialService,
  PasswordPolicyError,
  Pbkdf2PasswordHasher,
  normalizeLocalIdentifier,
  validateNewPassword,
  type PasswordBlocklist,
  type PasswordHasher,
} from "../src/worker/auth";

interface FakeCredential {
  userId: string;
  identifier: string;
  passwordHash: string;
  passwordChangedAt: string;
}

interface FakeResetToken {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: string;
  consumedAt: string | null;
}

interface BoundStatement {
  sql: string;
  args: unknown[];
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result<unknown>>;
}

class FakeD1 {
  readonly users = new Map<string, { status: "active" | "disabled" }>();
  readonly credentials = new Map<string, FakeCredential>();
  readonly sessions = new Map<string, { userId: string; revokedAt: string | null }>();
  readonly resetTokens = new Map<string, FakeResetToken>();

  prepare(sql: string) {
    return { bind: (...args: unknown[]) => this.statement(sql, args) };
  }

  private statement(sql: string, args: unknown[]): BoundStatement {
    return {
      sql,
      args,
      first: async <T>() => this.first<T>(sql, args),
      run: async () => this.run(sql, args),
    };
  }

  private async first<T>(sql: string, args: unknown[]): Promise<T | null> {
    if (sql.includes("FROM local_credentials c") && sql.includes("JOIN users u")) {
      const identifier = args[0] as string;
      const credential = [...this.credentials.values()].find((item) => item.identifier === identifier);
      if (!credential) return null;
      const user = this.users.get(credential.userId);
      if (!user) return null;
      return {
        user_id: credential.userId,
        password_hash: credential.passwordHash,
        status: user.status,
      } as T;
    }

    if (sql.includes("FROM local_credentials WHERE user_id = ?")) {
      const userId = args[0] as string;
      const credential = this.credentials.get(userId);
      if (!credential) return null;
      return {
        user_id: userId,
        password_hash: credential.passwordHash,
        status: "active",
      } as T;
    }

    if (sql.includes("FROM password_reset_tokens r") && sql.includes("JOIN users u")) {
      const [tokenHash, now] = args as [string, string];
      const reset = this.resetTokens.get(tokenHash);
      if (!reset || reset.consumedAt !== null || reset.expiresAt <= now) return null;
      const user = this.users.get(reset.userId);
      if (!user) return null;
      return {
        user_id: reset.userId,
        expires_at: reset.expiresAt,
        status: user.status,
      } as T;
    }

    throw new Error(`Unsupported first query: ${sql}`);
  }

  private async run(sql: string, args: unknown[]): Promise<D1Result<unknown>> {
    if (sql.includes("INSERT INTO local_credentials")) {
      const [userId, identifier, passwordHash, passwordChangedAt] = args as [string, string, string, string];
      if (this.credentials.has(userId)) throw new Error("duplicate user credential");
      if ([...this.credentials.values()].some((item) => item.identifier === identifier)) {
        throw new Error("duplicate identifier");
      }
      this.credentials.set(userId, { userId, identifier, passwordHash, passwordChangedAt });
      return { meta: { changes: 1 } } as D1Result<unknown>;
    }

    if (sql.includes("UPDATE local_credentials") && sql.includes("WHERE user_id = ? AND password_hash = ?")) {
      const newHash = args[0] as string;
      const passwordChangedAt = args[1] as string;
      const userId = args[3] as string;
      const oldHash = args[4] as string;
      const credential = this.credentials.get(userId);
      const matches = credential?.passwordHash === oldHash;
      if (credential && matches) {
        credential.passwordHash = newHash;
        credential.passwordChangedAt = passwordChangedAt;
      }
      return { meta: { changes: matches ? 1 : 0 } } as D1Result<unknown>;
    }

    throw new Error(`Unsupported standalone run query: ${sql}`);
  }

  async batch(statements: BoundStatement[]): Promise<D1Result<unknown>[]> {
    const results: D1Result<unknown>[] = [];
    for (const statement of statements) {
      const { sql, args } = statement;

      if (sql.includes("UPDATE local_credentials") && sql.includes("password_reset_tokens")) {
        const newHash = args[0] as string;
        const changedAt = args[1] as string;
        const userId = args[3] as string;
        const tokenHash = args[4] as string;
        const tokenUserId = args[5] as string;
        const now = args[6] as string;
        const reset = this.resetTokens.get(tokenHash);
        const allowed = !!reset
          && reset.userId === tokenUserId
          && reset.userId === userId
          && reset.consumedAt === null
          && reset.expiresAt > now
          && this.credentials.has(userId);
        if (allowed) {
          const credential = this.credentials.get(userId);
          assert.ok(credential);
          credential.passwordHash = newHash;
          credential.passwordChangedAt = changedAt;
        }
        results.push({ meta: { changes: allowed ? 1 : 0 } } as D1Result<unknown>);
        continue;
      }

      if (sql.includes("UPDATE local_credentials") && sql.includes("WHERE user_id = ? AND password_hash = ?")) {
        const newHash = args[0] as string;
        const changedAt = args[1] as string;
        const userId = args[3] as string;
        const oldHash = args[4] as string;
        const credential = this.credentials.get(userId);
        const allowed = credential?.passwordHash === oldHash;
        if (credential && allowed) {
          credential.passwordHash = newHash;
          credential.passwordChangedAt = changedAt;
        }
        results.push({ meta: { changes: allowed ? 1 : 0 } } as D1Result<unknown>);
        continue;
      }

      if (sql.includes("UPDATE application_sessions")) {
        const [revokedAt, userId] = args as [string, string];
        let changes = 0;
        for (const session of this.sessions.values()) {
          if (session.userId === userId && session.revokedAt === null) {
            session.revokedAt = revokedAt;
            changes += 1;
          }
        }
        results.push({ meta: { changes } } as D1Result<unknown>);
        continue;
      }

      if (sql.includes("INSERT INTO password_reset_tokens")) {
        const [id, tokenHash, userId, expiresAt] = args as [string, string, string, string];
        this.resetTokens.set(tokenHash, { id, tokenHash, userId, expiresAt, consumedAt: null });
        results.push({ meta: { changes: 1 } } as D1Result<unknown>);
        continue;
      }

      if (sql.includes("UPDATE password_reset_tokens") && sql.includes("WHERE token_hash = ?")) {
        const [consumedAt, tokenHash, userId, now] = args as [string, string, string, string];
        const reset = this.resetTokens.get(tokenHash);
        const allowed = !!reset
          && reset.userId === userId
          && reset.consumedAt === null
          && reset.expiresAt > now;
        if (reset && allowed) reset.consumedAt = consumedAt;
        results.push({ meta: { changes: allowed ? 1 : 0 } } as D1Result<unknown>);
        continue;
      }

      if (sql.includes("UPDATE password_reset_tokens") && sql.includes("WHERE user_id = ?")) {
        const [consumedAt, userId] = args as [string, string];
        let changes = 0;
        for (const reset of this.resetTokens.values()) {
          if (reset.userId === userId && reset.consumedAt === null) {
            reset.consumedAt = consumedAt;
            changes += 1;
          }
        }
        results.push({ meta: { changes } } as D1Result<unknown>);
        continue;
      }

      throw new Error(`Unsupported batch query: ${sql}`);
    }
    return results;
  }
}

class DeterministicHasher implements PasswordHasher {
  readonly burned: string[] = [];
  async hash(password: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`test:${password}`));
    return `test-hash:${Buffer.from(digest).toString("hex")}`;
  }
  async verify(password: string, encodedHash: string) {
    return { valid: (await this.hash(password)) === encodedHash, needsRehash: false };
  }
  async burn(password: string): Promise<void> {
    this.burned.push(password);
    await this.hash(password);
  }
}

const allowAll: PasswordBlocklist = { isBlocked: async () => false };
const blockKnown: PasswordBlocklist = { isBlocked: async (password) => password === "known-compromised-password" };
const asD1 = (db: FakeD1) => db as unknown as D1Database;
const fixedClock = { now: () => new Date("2026-10-04T00:00:00.000Z") };
const fixedIds = { generate: () => "reset-id-1" };

const makeService = (db: FakeD1, hasher = new DeterministicHasher()) => ({
  service: new LocalCredentialService({
    db: asD1(db),
    blocklist: allowAll,
    hasher,
    clock: fixedClock,
    idGenerator: fixedIds,
  }),
  hasher,
});

test("PBKDF2 hashes use unique salt, verify correctly, and carry a rehashable work factor", async () => {
  const weakForTest = new Pbkdf2PasswordHasher({
    iterations: 1_000,
    unsafeAllowBelowRecommendedIterationsForTests: true,
  });
  const strongerForTest = new Pbkdf2PasswordHasher({
    iterations: 2_000,
    unsafeAllowBelowRecommendedIterationsForTests: true,
  });
  const first = await weakForTest.hash("Correct Horse Battery Staple");
  const second = await weakForTest.hash("Correct Horse Battery Staple");

  assert.notEqual(first, second);
  assert.match(first, /^pbkdf2-sha256\$1000\$/u);
  assert.deepEqual(await weakForTest.verify("Correct Horse Battery Staple", first), {
    valid: true,
    needsRehash: false,
  });
  assert.equal((await weakForTest.verify("wrong password", first)).valid, false);
  assert.deepEqual(await strongerForTest.verify("Correct Horse Battery Staple", first), {
    valid: true,
    needsRehash: true,
  });
});

test("password policy uses length and blocklist without composition rules", async () => {
  await assert.rejects(
    validateNewPassword("short", allowAll),
    (error: unknown) => error instanceof PasswordPolicyError && error.code === "too_short",
  );
  await assert.rejects(
    validateNewPassword("known-compromised-password", blockKnown),
    (error: unknown) => error instanceof PasswordPolicyError && error.code === "blocked",
  );
  assert.equal(
    await validateNewPassword("this is a long passphrase", allowAll),
    "this is a long passphrase",
  );
});

test("local identifier is normalized deterministically", () => {
  assert.equal(normalizeLocalIdentifier("  User.Name@example.COM  "), "user.name@example.com");
  assert.throws(() => normalizeLocalIdentifier("bad\nidentifier"), /invalid/u);
});

test("authentication does not reveal whether an identifier exists and disabled users cannot authenticate", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { status: "active" });
  const { service, hasher } = makeService(fake);
  await service.provision("user-1", "User@example.com", "a sufficiently long password");

  assert.deepEqual(await service.authenticate("user@example.com", "a sufficiently long password"), {
    userId: "user-1",
    credentialUpgraded: false,
  });
  assert.equal(await service.authenticate("user@example.com", "wrong password"), null);
  assert.equal(await service.authenticate("missing@example.com", "wrong password"), null);
  assert.equal(hasher.burned.length, 1);

  const user = fake.users.get("user-1");
  assert.ok(user);
  user.status = "disabled";
  assert.equal(await service.authenticate("user@example.com", "a sufficiently long password"), null);
  assert.equal(hasher.burned.length, 2);
});

test("password change revokes existing sessions and invalidates outstanding reset tokens", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { status: "active" });
  const { service } = makeService(fake);
  await service.provision("user-1", "user@example.com", "a sufficiently long password");
  fake.sessions.set("session-a", { userId: "user-1", revokedAt: null });
  const reset = await service.issuePasswordResetToken("user-1");

  await service.changePassword(
    "user-1",
    "a sufficiently long password",
    "a different sufficiently long password",
  );

  assert.ok(fake.sessions.get("session-a")?.revokedAt);
  assert.equal([...fake.resetTokens.values()][0]?.consumedAt !== null, true);
  assert.equal(await service.authenticate("user@example.com", "a sufficiently long password"), null);
  assert.deepEqual(await service.authenticate("user@example.com", "a different sufficiently long password"), {
    userId: "user-1",
    credentialUpgraded: false,
  });
  await assert.rejects(
    service.resetPassword(reset.token, "another sufficiently long password"),
    (error: unknown) => error instanceof LocalCredentialMutationError && error.code === "reset_token_invalid",
  );
});

test("password reset persists only token hash, is one-time, and revokes existing sessions", async () => {
  const fake = new FakeD1();
  fake.users.set("user-1", { status: "active" });
  const { service } = makeService(fake);
  await service.provision("user-1", "user@example.com", "a sufficiently long password");
  fake.sessions.set("session-a", { userId: "user-1", revokedAt: null });

  const issued = await service.issuePasswordResetToken("user-1", 600);
  const stored = [...fake.resetTokens.values()][0];
  assert.ok(stored);
  assert.notEqual(stored.tokenHash, issued.token);
  assert.equal(JSON.stringify(stored).includes(issued.token), false);

  await service.resetPassword(issued.token, "reset to another long password");
  assert.ok(fake.sessions.get("session-a")?.revokedAt);
  assert.equal(stored.consumedAt !== null, true);
  assert.deepEqual(await service.authenticate("user@example.com", "reset to another long password"), {
    userId: "user-1",
    credentialUpgraded: false,
  });
  await assert.rejects(
    service.resetPassword(issued.token, "yet another sufficiently long password"),
    (error: unknown) => error instanceof LocalCredentialMutationError && error.code === "reset_token_invalid",
  );
});
