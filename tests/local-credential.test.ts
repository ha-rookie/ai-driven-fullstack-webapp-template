import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalCredentialMutationError,
  LocalCredentialService,
  PasswordPolicyError,
  Pbkdf2PasswordHasher,
  normalizeLocalIdentifier,
  validateNewPassword,
  type PasswordHasher,
} from "../src/worker/auth";
import { createFixedClock, type IdGenerator } from "../src/shared/runtime";

interface CredentialRecord {
  userId: string;
  identifier: string;
  passwordHash: string;
}

interface ResetRecord {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: string;
  consumedAt: string | null;
}

interface SessionRecord {
  userId: string;
  revokedAt: string | null;
}

class FakeStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeDatabase,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]): FakeStatement {
    this.values = values;
    return this;
  }

  get boundValues(): readonly unknown[] {
    return this.values;
  }

  async first<T>(): Promise<T | null> {
    const sql = this.sql.replace(/\s+/gu, " ").trim();

    if (sql.includes("FROM local_credentials c") && sql.includes("identifier_normalized = ?")) {
      const identifier = String(this.values[0]);
      const credential = [...this.db.credentials.values()].find((item) => item.identifier === identifier);
      if (!credential) return null;
      return {
        user_id: credential.userId,
        password_hash: credential.passwordHash,
        status: this.db.users.get(credential.userId) ?? "disabled",
      } as T;
    }

    if (sql.includes("FROM local_credentials WHERE user_id = ?")) {
      const userId = String(this.values[0]);
      const credential = this.db.credentials.get(userId);
      if (!credential) return null;
      return {
        user_id: credential.userId,
        password_hash: credential.passwordHash,
        status: "active",
      } as T;
    }

    if (sql.includes("FROM password_reset_tokens r")) {
      const tokenHash = String(this.values[0]);
      const now = String(this.values[1]);
      const reset = [...this.db.resets.values()].find((item) => item.tokenHash === tokenHash);
      if (!reset || reset.consumedAt !== null || reset.expiresAt <= now) return null;
      return {
        user_id: reset.userId,
        expires_at: reset.expiresAt,
        status: this.db.users.get(reset.userId) ?? "disabled",
      } as T;
    }

    throw new Error(`Unsupported first() SQL: ${sql}`);
  }

  async run(): Promise<D1Result<unknown>> {
    return this.db.run(this.sql, this.values);
  }
}

class FakeDatabase {
  readonly users = new Map<string, "active" | "disabled">();
  readonly credentials = new Map<string, CredentialRecord>();
  readonly resets = new Map<string, ResetRecord>();
  readonly sessions: SessionRecord[] = [];

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]): Promise<D1Result<unknown>[]> {
    const results: D1Result<unknown>[] = [];
    for (const statement of statements) {
      results.push(await this.run(statement.sql, statement.boundValues));
    }
    return results;
  }

  async run(sqlValue: string, values: readonly unknown[]): Promise<D1Result<unknown>> {
    const sql = sqlValue.replace(/\s+/gu, " ").trim();
    let changes = 0;

    if (sql.startsWith("INSERT INTO local_credentials")) {
      const [userId, identifier, passwordHash] = values.map(String);
      if ([...this.credentials.values()].some((item) => item.identifier === identifier)) {
        throw new Error("UNIQUE constraint failed: local_credentials.identifier_normalized");
      }
      this.credentials.set(userId, { userId, identifier, passwordHash });
      changes = 1;
    } else if (
      sql.startsWith("UPDATE local_credentials")
      && sql.includes("WHERE user_id = ? AND password_hash = ?")
    ) {
      const [newHash, , , userId, expectedHash] = values.map(String);
      const current = this.credentials.get(userId);
      if (current?.passwordHash === expectedHash) {
        this.credentials.set(userId, { ...current, passwordHash: newHash });
        changes = 1;
      }
    } else if (
      sql.startsWith("UPDATE local_credentials")
      && sql.includes("SELECT 1 FROM password_reset_tokens")
    ) {
      const [newHash, , , userId, tokenHash, resetUserId, now] = values.map(String);
      const reset = [...this.resets.values()].find((item) => item.tokenHash === tokenHash);
      const current = this.credentials.get(userId);
      if (
        current
        && reset
        && reset.userId === resetUserId
        && reset.userId === userId
        && reset.consumedAt === null
        && reset.expiresAt > now
      ) {
        this.credentials.set(userId, { ...current, passwordHash: newHash });
        changes = 1;
      }
    } else if (sql.startsWith("UPDATE application_sessions")) {
      const [now, userId, conditionUserId, expectedHash] = values.map(String);
      const current = this.credentials.get(conditionUserId);
      if (current?.passwordHash === expectedHash && conditionUserId === userId) {
        for (const session of this.sessions) {
          if (session.userId === userId && session.revokedAt === null) {
            session.revokedAt = now;
            changes += 1;
          }
        }
      }
    } else if (
      sql.startsWith("UPDATE password_reset_tokens")
      && sql.includes("WHERE token_hash = ?")
    ) {
      const [now, tokenHash, userId, boundary] = values.map(String);
      const reset = [...this.resets.values()].find((item) => item.tokenHash === tokenHash);
      if (
        reset
        && reset.userId === userId
        && reset.consumedAt === null
        && reset.expiresAt > boundary
      ) {
        reset.consumedAt = now;
        changes = 1;
      }
    } else if (
      sql.startsWith("UPDATE password_reset_tokens")
      && sql.includes("AND EXISTS (SELECT 1 FROM local_credentials")
    ) {
      const [now, userId, conditionUserId, expectedHash] = values.map(String);
      const current = this.credentials.get(conditionUserId);
      if (current?.passwordHash === expectedHash && conditionUserId === userId) {
        for (const reset of this.resets.values()) {
          if (reset.userId === userId && reset.consumedAt === null) {
            reset.consumedAt = now;
            changes += 1;
          }
        }
      }
    } else if (
      sql.startsWith("UPDATE password_reset_tokens")
      && sql.includes("WHERE user_id = ? AND consumed_at IS NULL")
    ) {
      const [now, userId] = values.map(String);
      for (const reset of this.resets.values()) {
        if (reset.userId === userId && reset.consumedAt === null) {
          reset.consumedAt = now;
          changes += 1;
        }
      }
    } else if (sql.startsWith("INSERT INTO password_reset_tokens")) {
      const [id, tokenHash, userId, expiresAt] = values.map(String);
      this.resets.set(id, { id, tokenHash, userId, expiresAt, consumedAt: null });
      changes = 1;
    } else {
      throw new Error(`Unsupported run() SQL: ${sql}`);
    }

    return { meta: { changes } } as D1Result<unknown>;
  }
}

class FakeHasher implements PasswordHasher {
  burnCalls = 0;

  async hash(password: string): Promise<string> {
    return `hash:${password}:v2`;
  }

  async verify(password: string, encodedHash: string) {
    return {
      valid: encodedHash === `hash:${password}:v2` || encodedHash === `hash:${password}:v1`,
      needsRehash: encodedHash.endsWith(":v1"),
    };
  }

  async burn(_password: string): Promise<void> {
    this.burnCalls += 1;
  }
}

const blocklist = {
  async isBlocked(password: string): Promise<boolean> {
    return password === "this password is blocked";
  },
};

const createService = (db: FakeDatabase, hasher = new FakeHasher()) => {
  let nextId = 1;
  const idGenerator: IdGenerator = { generate: () => `id-${nextId++}` };
  const service = new LocalCredentialService({
    db: db as unknown as D1Database,
    blocklist,
    hasher,
    clock: createFixedClock("2026-10-04T00:00:00.000Z"),
    idGenerator,
  });
  return { service, hasher };
};

test("PBKDF2 hashes with salt and verifies without storing plaintext", async () => {
  const hasher = new Pbkdf2PasswordHasher({
    iterations: 1_000,
    unsafeAllowBelowRecommendedIterationsForTests: true,
  });
  const encoded = await hasher.hash("correct horse battery staple");

  assert.match(encoded, /^pbkdf2-sha256\$1000\$/u);
  assert.doesNotMatch(encoded, /correct horse battery staple/u);
  assert.deepEqual(await hasher.verify("correct horse battery staple", encoded), {
    valid: true,
    needsRehash: false,
  });
  assert.equal((await hasher.verify("wrong password", encoded)).valid, false);
});

test("identifier normalization and password policy are explicit", async () => {
  assert.equal(normalizeLocalIdentifier("  User.Name@example.com  "), "user.name@example.com");
  await assert.rejects(
    () => validateNewPassword("short", blocklist),
    (error: unknown) => error instanceof PasswordPolicyError && error.code === "too_short",
  );
  await assert.rejects(
    () => validateNewPassword("this password is blocked", blocklist),
    (error: unknown) => error instanceof PasswordPolicyError && error.code === "blocked",
  );
  assert.equal(
    await validateNewPassword("a sufficiently long passphrase", blocklist),
    "a sufficiently long passphrase",
  );
});

test("unknown and disabled identifiers use dummy password work and do not disclose account state", async () => {
  const db = new FakeDatabase();
  db.users.set("user-disabled", "disabled");
  db.credentials.set("user-disabled", {
    userId: "user-disabled",
    identifier: "disabled@example.com",
    passwordHash: "hash:a sufficiently long passphrase:v2",
  });
  const { service, hasher } = createService(db);

  assert.equal(await service.authenticate("missing@example.com", "candidate password value"), null);
  assert.equal(await service.authenticate("disabled@example.com", "candidate password value"), null);
  assert.equal(hasher.burnCalls, 2);
});

test("successful authentication returns only the internal user id and upgrades old hash parameters", async () => {
  const db = new FakeDatabase();
  db.users.set("user-1", "active");
  db.credentials.set("user-1", {
    userId: "user-1",
    identifier: "user@example.com",
    passwordHash: "hash:a sufficiently long passphrase:v1",
  });
  const { service } = createService(db);

  assert.deepEqual(await service.authenticate("USER@example.com", "a sufficiently long passphrase"), {
    userId: "user-1",
    credentialUpgraded: true,
  });
  assert.equal(db.credentials.get("user-1")?.passwordHash, "hash:a sufficiently long passphrase:v2");
});

test("password change revokes active sessions and outstanding reset tokens", async () => {
  const db = new FakeDatabase();
  db.users.set("user-1", "active");
  db.credentials.set("user-1", {
    userId: "user-1",
    identifier: "user@example.com",
    passwordHash: "hash:current password value:v2",
  });
  db.sessions.push({ userId: "user-1", revokedAt: null });
  db.resets.set("old-reset", {
    id: "old-reset",
    tokenHash: "old-token-hash",
    userId: "user-1",
    expiresAt: "2026-10-04T01:00:00.000Z",
    consumedAt: null,
  });
  const { service } = createService(db);

  await service.changePassword(
    "user-1",
    "current password value",
    "replacement password value",
  );

  assert.equal(db.credentials.get("user-1")?.passwordHash, "hash:replacement password value:v2");
  assert.equal(db.sessions[0]?.revokedAt, "2026-10-04T00:00:00.000Z");
  assert.equal(db.resets.get("old-reset")?.consumedAt, "2026-10-04T00:00:00.000Z");
});

test("password reset token is stored only as a hash, is one-time, and revokes sessions", async () => {
  const db = new FakeDatabase();
  db.users.set("user-1", "active");
  db.credentials.set("user-1", {
    userId: "user-1",
    identifier: "user@example.com",
    passwordHash: "hash:current password value:v2",
  });
  db.sessions.push({ userId: "user-1", revokedAt: null });
  const { service } = createService(db);

  const issued = await service.issuePasswordResetToken("user-1", 600);
  const stored = [...db.resets.values()][0];
  assert.ok(stored);
  assert.notEqual(stored.tokenHash, issued.token);
  assert.equal(stored.expiresAt, "2026-10-04T00:10:00.000Z");

  await service.resetPassword(issued.token, "replacement password value");
  assert.equal(db.credentials.get("user-1")?.passwordHash, "hash:replacement password value:v2");
  assert.equal(stored.consumedAt, "2026-10-04T00:00:00.000Z");
  assert.equal(db.sessions[0]?.revokedAt, "2026-10-04T00:00:00.000Z");

  await assert.rejects(
    () => service.resetPassword(issued.token, "another replacement password"),
    (error: unknown) => error instanceof LocalCredentialMutationError && error.code === "reset_token_invalid",
  );
});
