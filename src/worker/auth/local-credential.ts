import { pbkdf2 as nodePbkdf2, scrypt as nodeScrypt } from "node:crypto";
import type { Clock, IdGenerator } from "../../shared/runtime";
import { cryptoIdGenerator, systemClock } from "../../shared/runtime";

export const LOCAL_CREDENTIAL_PROVIDER = "local";
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const DEFAULT_SCRYPT_N = 2 ** 15;
export const DEFAULT_SCRYPT_R = 8;
export const DEFAULT_SCRYPT_P = 3;
export const DEFAULT_PASSWORD_RESET_TTL_SECONDS = 30 * 60;
export const DEFAULT_PASSWORD_MIN_CODE_POINTS = 15;
export const DEFAULT_PASSWORD_MAX_CODE_POINTS = 128;

const PBKDF2_SALT_BYTES = 16;
const PBKDF2_OUTPUT_BITS = 256;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_OUTPUT_BYTES = 32;
const SCRYPT_MAXMEM_BYTES = 64 * 1024 * 1024;
const RESET_TOKEN_BYTES = 32;
const MAX_IDENTIFIER_CODE_POINTS = 254;
const MAX_PASSWORD_VERIFY_CODE_POINTS = 1024;
const PBKDF2_PBKDF2_HASH_FORMAT_PREFIX = "pbkdf2-sha256";
const SCRYPT_PBKDF2_HASH_FORMAT_PREFIX = "scrypt";
const DUMMY_SALT = new Uint8Array(SCRYPT_SALT_BYTES);

export type PasswordPolicyErrorCode =
  | "too_short"
  | "too_long"
  | "blocked";

export class PasswordPolicyError extends Error {
  constructor(readonly code: PasswordPolicyErrorCode) {
    super("Password does not satisfy the configured policy");
    this.name = "PasswordPolicyError";
  }
}

export type LocalCredentialMutationErrorCode =
  | "credential_not_found"
  | "current_password_invalid"
  | "concurrent_change"
  | "reset_token_invalid";

export class LocalCredentialMutationError extends Error {
  constructor(readonly code: LocalCredentialMutationErrorCode) {
    super("Local credential mutation failed");
    this.name = "LocalCredentialMutationError";
  }
}

export type LocalCredentialAuthenticationDependencyStage =
  | "credential_lookup"
  | "password_verify"
  | "credential_rehash";

export class LocalCredentialAuthenticationDependencyError extends Error {
  constructor(
    readonly stage: LocalCredentialAuthenticationDependencyStage,
    options?: ErrorOptions,
  ) {
    super("Local credential authentication dependency failed", options);
    this.name = "LocalCredentialAuthenticationDependencyError";
  }
}

export interface PasswordBlocklist {
  isBlocked(password: string): Promise<boolean>;
}

export interface LocalPasswordPolicy {
  readonly minCodePoints?: number;
  readonly maxCodePoints?: number;
}

export interface PasswordHashVerification {
  readonly valid: boolean;
  readonly needsRehash: boolean;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<PasswordHashVerification>;
  burn(password: string): Promise<void>;
}

export interface Pbkdf2PasswordHasherOptions {
  readonly iterations?: number;
  /** Test-only escape hatch. Never enable this in Preview or Production. */
  readonly unsafeAllowBelowRecommendedIterationsForTests?: boolean;
}

const codePointLength = (value: string): number => Array.from(value).length;

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point !== undefined && (point < 32 || point === 127)) return true;
  }
  return false;
};

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const fromBase64Url = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError("Invalid base64url value");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const constantTimeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
};

const normalizePasswordForHashing = (password: string): string => password.normalize("NFC");

const derivePbkdf2 = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    nodePbkdf2(
      normalizePasswordForHashing(password),
      Buffer.from(salt),
      iterations,
      PBKDF2_OUTPUT_BITS / 8,
      "sha256",
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(new Uint8Array(derivedKey));
      },
    );
  });

interface ParsedPasswordHash {
  readonly iterations: number;
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
}

const parsePasswordHash = (encodedHash: string): ParsedPasswordHash => {
  const parts = encodedHash.split("$");
  if (parts.length !== 4 || parts[0] !== PBKDF2_HASH_FORMAT_PREFIX) {
    throw new TypeError("Unsupported password hash format");
  }
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations <= 0) {
    throw new TypeError("Invalid PBKDF2 iteration count");
  }
  const salt = fromBase64Url(parts[2]);
  const hash = fromBase64Url(parts[3]);
  if (salt.byteLength < PBKDF2_SALT_BYTES || hash.byteLength !== PBKDF2_OUTPUT_BITS / 8) {
    throw new TypeError("Invalid PBKDF2 hash payload");
  }
  return { iterations, salt, hash };
};

export class Pbkdf2PasswordHasher implements PasswordHasher {
  readonly iterations: number;

  constructor(options: Pbkdf2PasswordHasherOptions = {}) {
    this.iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
    if (!Number.isSafeInteger(this.iterations) || this.iterations <= 0) {
      throw new RangeError("PBKDF2 iterations must be a positive safe integer");
    }
    if (
      this.iterations < DEFAULT_PBKDF2_ITERATIONS
      && options.unsafeAllowBelowRecommendedIterationsForTests !== true
    ) {
      throw new RangeError(`PBKDF2 iterations must be at least ${DEFAULT_PBKDF2_ITERATIONS}`);
    }
  }

  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
    const hash = await derivePbkdf2(password, salt, this.iterations);
    return `${PBKDF2_HASH_FORMAT_PREFIX}$${this.iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
  }

  async verify(password: string, encodedHash: string): Promise<PasswordHashVerification> {
    const parsed = parsePasswordHash(encodedHash);
    const actual = await derivePbkdf2(password, parsed.salt, parsed.iterations);
    return {
      valid: constantTimeEqual(actual, parsed.hash),
      needsRehash: parsed.iterations < this.iterations,
    };
  }

  async burn(password: string): Promise<void> {
    await derivePbkdf2(password, DUMMY_SALT, this.iterations);
  }
}


export interface ScryptPasswordHasherOptions {
  readonly n?: number;
  readonly r?: number;
  readonly p?: number;
  readonly maxmem?: number;
  /** Test-only escape hatch. Never enable this in Preview or Production. */
  readonly unsafeAllowBelowRecommendedParametersForTests?: boolean;
}

interface ParsedScryptPasswordHash {
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
}

const deriveScrypt = async (
  password: string,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  maxmem: number,
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    nodeScrypt(
      normalizePasswordForHashing(password),
      Buffer.from(salt),
      SCRYPT_OUTPUT_BYTES,
      { N: n, r, p, maxmem },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(new Uint8Array(derivedKey));
      },
    );
  });

const parseScryptPasswordHash = (encodedHash: string): ParsedScryptPasswordHash => {
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== SCRYPT_HASH_FORMAT_PREFIX) {
    throw new TypeError("Unsupported scrypt password hash format");
  }
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isSafeInteger(n) || n <= 1 || (n & (n - 1)) !== 0
    || !Number.isSafeInteger(r) || r <= 0
    || !Number.isSafeInteger(p) || p <= 0
  ) {
    throw new TypeError("Invalid scrypt parameters");
  }
  const salt = fromBase64Url(parts[4]);
  const hash = fromBase64Url(parts[5]);
  if (salt.byteLength < SCRYPT_SALT_BYTES || hash.byteLength !== SCRYPT_OUTPUT_BYTES) {
    throw new TypeError("Invalid scrypt hash payload");
  }
  return { n, r, p, salt, hash };
};

export class ScryptPasswordHasher implements PasswordHasher {
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly maxmem: number;
  private readonly legacyPbkdf2 = new Pbkdf2PasswordHasher();

  constructor(options: ScryptPasswordHasherOptions = {}) {
    this.n = options.n ?? DEFAULT_SCRYPT_N;
    this.r = options.r ?? DEFAULT_SCRYPT_R;
    this.p = options.p ?? DEFAULT_SCRYPT_P;
    this.maxmem = options.maxmem ?? SCRYPT_MAXMEM_BYTES;

    const recommended =
      this.n === DEFAULT_SCRYPT_N
      && this.r === DEFAULT_SCRYPT_R
      && this.p === DEFAULT_SCRYPT_P;
    if (
      (!Number.isSafeInteger(this.n) || this.n <= 1 || (this.n & (this.n - 1)) !== 0)
      || !Number.isSafeInteger(this.r) || this.r <= 0
      || !Number.isSafeInteger(this.p) || this.p <= 0
      || !Number.isSafeInteger(this.maxmem) || this.maxmem <= 0
    ) {
      throw new RangeError("scrypt parameters are invalid");
    }
    if (!recommended && options.unsafeAllowBelowRecommendedParametersForTests !== true) {
      throw new RangeError("scrypt parameters must use the recommended production profile");
    }
  }

  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SCRYPT_SALT_BYTES));
    const hash = await deriveScrypt(password, salt, this.n, this.r, this.p, this.maxmem);
    return [
      SCRYPT_HASH_FORMAT_PREFIX,
      this.n,
      this.r,
      this.p,
      toBase64Url(salt),
      toBase64Url(hash),
    ].join("$");
  }

  async verify(password: string, encodedHash: string): Promise<PasswordHashVerification> {
    if (encodedHash.startsWith(`${PBKDF2_HASH_FORMAT_PREFIX}$`)) {
      const legacy = await this.legacyPbkdf2.verify(password, encodedHash);
      return { valid: legacy.valid, needsRehash: legacy.valid };
    }

    const parsed = parseScryptPasswordHash(encodedHash);
    const actual = await deriveScrypt(password, parsed.salt, parsed.n, parsed.r, parsed.p, this.maxmem);
    return {
      valid: constantTimeEqual(actual, parsed.hash),
      needsRehash:
        parsed.n !== this.n
        || parsed.r !== this.r
        || parsed.p !== this.p,
    };
  }

  async burn(password: string): Promise<void> {
    await deriveScrypt(password, DUMMY_SALT, this.n, this.r, this.p, this.maxmem);
  }
}

export const normalizeLocalIdentifier = (identifier: string): string => {
  const normalized = identifier.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (
    normalized.length === 0
    || codePointLength(normalized) > MAX_IDENTIFIER_CODE_POINTS
    || containsControlCharacter(normalized)
  ) {
    throw new TypeError("Local credential identifier is invalid");
  }
  return normalized;
};

export const validateNewPassword = async (
  password: string,
  blocklist: PasswordBlocklist,
  policy: LocalPasswordPolicy = {},
): Promise<string> => {
  const normalized = normalizePasswordForHashing(password);
  const length = codePointLength(normalized);
  const minimum = policy.minCodePoints ?? DEFAULT_PASSWORD_MIN_CODE_POINTS;
  const maximum = policy.maxCodePoints ?? DEFAULT_PASSWORD_MAX_CODE_POINTS;
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 1 || maximum < minimum) {
    throw new RangeError("Password length policy is invalid");
  }
  if (length < minimum) throw new PasswordPolicyError("too_short");
  if (length > maximum) throw new PasswordPolicyError("too_long");
  if (await blocklist.isBlocked(normalized)) throw new PasswordPolicyError("blocked");
  return normalized;
};

const sha256Text = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(new TextEncoder().encode(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const createOpaqueToken = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(RESET_TOKEN_BYTES)));

interface CredentialRow {
  readonly user_id: string;
  readonly password_hash: string;
  readonly status: string;
}

interface ResetTokenRow {
  readonly user_id: string;
  readonly expires_at: string;
  readonly status: string;
}

export interface LocalCredentialAuthenticationResult {
  readonly userId: string;
  readonly credentialUpgraded: boolean;
}

export interface IssuedPasswordResetToken {
  /** Raw token. Deliver once through a protected channel and never persist/log it. */
  readonly token: string;
  readonly expiresAt: string;
}

export interface LocalCredentialServiceOptions {
  readonly db: D1Database;
  readonly blocklist: PasswordBlocklist;
  readonly hasher?: PasswordHasher;
  readonly passwordPolicy?: LocalPasswordPolicy;
  readonly normalizeIdentifier?: (identifier: string) => string;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
}

export class LocalCredentialService {
  private readonly hasher: PasswordHasher;
  private readonly normalizeIdentifier: (identifier: string) => string;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;

  constructor(private readonly options: LocalCredentialServiceOptions) {
    this.hasher = options.hasher ?? new ScryptPasswordHasher();
    this.normalizeIdentifier = options.normalizeIdentifier ?? normalizeLocalIdentifier;
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? cryptoIdGenerator;
  }

  async provision(userId: string, identifier: string, password: string): Promise<void> {
    const normalizedIdentifier = this.normalizeIdentifier(identifier);
    const normalizedPassword = await validateNewPassword(
      password,
      this.options.blocklist,
      this.options.passwordPolicy,
    );
    const passwordHash = await this.hasher.hash(normalizedPassword);
    const now = this.clock.now().toISOString();
    await this.options.db.prepare(`
      INSERT INTO local_credentials (
        user_id, identifier_normalized, password_hash, password_changed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(userId, normalizedIdentifier, passwordHash, now, now, now).run();
  }

  async authenticate(identifier: string, password: string): Promise<LocalCredentialAuthenticationResult | null> {
    let normalizedIdentifier: string;
    try {
      normalizedIdentifier = this.normalizeIdentifier(identifier);
    } catch {
      await this.burnBoundedPassword(password);
      return null;
    }

    let row: CredentialRow | null;
    try {
      row = await this.options.db.prepare(`
        SELECT c.user_id, c.password_hash, u.status
        FROM local_credentials c
        JOIN users u ON u.id = c.user_id
        WHERE c.identifier_normalized = ?
      `).bind(normalizedIdentifier).first<CredentialRow>();
    } catch (error) {
      throw new LocalCredentialAuthenticationDependencyError("credential_lookup", { cause: error });
    }

    if (!row || row.status !== "active") {
      await this.burnBoundedPassword(password);
      return null;
    }

    const candidate = this.boundPasswordForVerification(password);
    let verification: PasswordHashVerification;
    try {
      verification = await this.hasher.verify(candidate, row.password_hash);
    } catch (error) {
      throw new LocalCredentialAuthenticationDependencyError("password_verify", { cause: error });
    }
    if (!verification.valid) return null;

    let credentialUpgraded = false;
    if (verification.needsRehash) {
      try {
        const upgraded = await this.hasher.hash(candidate);
        const now = this.clock.now().toISOString();
        const result = await this.options.db.prepare(`
          UPDATE local_credentials
          SET password_hash = ?, password_changed_at = ?, updated_at = ?
          WHERE user_id = ? AND password_hash = ?
        `).bind(upgraded, now, now, row.user_id, row.password_hash).run();
        credentialUpgraded = (result.meta.changes ?? 0) === 1;
      } catch (error) {
        throw new LocalCredentialAuthenticationDependencyError("credential_rehash", { cause: error });
      }
    }

    return { userId: row.user_id, credentialUpgraded };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const row = await this.options.db.prepare(
      "SELECT user_id, password_hash, 'active' AS status FROM local_credentials WHERE user_id = ?",
    ).bind(userId).first<CredentialRow>();
    if (!row) throw new LocalCredentialMutationError("credential_not_found");

    const current = await this.hasher.verify(this.boundPasswordForVerification(currentPassword), row.password_hash);
    if (!current.valid) throw new LocalCredentialMutationError("current_password_invalid");

    const normalizedNewPassword = await validateNewPassword(
      newPassword,
      this.options.blocklist,
      this.options.passwordPolicy,
    );
    const newHash = await this.hasher.hash(normalizedNewPassword);
    const now = this.clock.now().toISOString();
    const results = await this.options.db.batch([
      this.options.db.prepare(`
        UPDATE local_credentials
        SET password_hash = ?, password_changed_at = ?, updated_at = ?
        WHERE user_id = ? AND password_hash = ?
      `).bind(newHash, now, now, userId, row.password_hash),
      this.options.db.prepare(`
        UPDATE application_sessions
        SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM local_credentials WHERE user_id = ? AND password_hash = ?)
      `).bind(now, userId, userId, newHash),
      this.options.db.prepare(`
        UPDATE password_reset_tokens
        SET consumed_at = ?
        WHERE user_id = ? AND consumed_at IS NULL
          AND EXISTS (SELECT 1 FROM local_credentials WHERE user_id = ? AND password_hash = ?)
      `).bind(now, userId, userId, newHash),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      throw new LocalCredentialMutationError("concurrent_change");
    }
  }

  async issuePasswordResetToken(
    userId: string,
    ttlSeconds = DEFAULT_PASSWORD_RESET_TTL_SECONDS,
  ): Promise<IssuedPasswordResetToken> {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 24 * 60 * 60) {
      throw new RangeError("Password reset TTL must be between 1 second and 24 hours");
    }
    const token = createOpaqueToken();
    const tokenHash = await sha256Text(token);
    const nowDate = this.clock.now();
    const now = nowDate.toISOString();
    const expiresAt = new Date(nowDate.getTime() + ttlSeconds * 1000).toISOString();
    const id = this.idGenerator.generate();

    await this.options.db.batch([
      this.options.db.prepare(
        "UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL",
      ).bind(now, userId),
      this.options.db.prepare(`
        INSERT INTO password_reset_tokens (
          id, token_hash, user_id, expires_at, consumed_at, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?)
      `).bind(id, tokenHash, userId, expiresAt, now),
    ]);

    return { token, expiresAt };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = await sha256Text(token);
    const now = this.clock.now().toISOString();
    const reset = await this.options.db.prepare(`
      SELECT r.user_id, r.expires_at, u.status
      FROM password_reset_tokens r
      JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ? AND r.consumed_at IS NULL AND r.expires_at > ?
    `).bind(tokenHash, now).first<ResetTokenRow>();
    if (!reset || reset.status !== "active") {
      throw new LocalCredentialMutationError("reset_token_invalid");
    }

    const normalizedNewPassword = await validateNewPassword(
      newPassword,
      this.options.blocklist,
      this.options.passwordPolicy,
    );
    const newHash = await this.hasher.hash(normalizedNewPassword);
    const results = await this.options.db.batch([
      this.options.db.prepare(`
        UPDATE local_credentials
        SET password_hash = ?, password_changed_at = ?, updated_at = ?
        WHERE user_id = ?
          AND EXISTS (
            SELECT 1 FROM password_reset_tokens
            WHERE token_hash = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?
          )
      `).bind(newHash, now, now, reset.user_id, tokenHash, reset.user_id, now),
      this.options.db.prepare(`
        UPDATE password_reset_tokens
        SET consumed_at = ?
        WHERE token_hash = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?
      `).bind(now, tokenHash, reset.user_id, now),
      this.options.db.prepare(`
        UPDATE application_sessions
        SET revoked_at = ?
        WHERE user_id = ? AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM local_credentials WHERE user_id = ? AND password_hash = ?)
      `).bind(now, reset.user_id, reset.user_id, newHash),
      this.options.db.prepare(`
        UPDATE password_reset_tokens
        SET consumed_at = ?
        WHERE user_id = ? AND consumed_at IS NULL
          AND EXISTS (SELECT 1 FROM local_credentials WHERE user_id = ? AND password_hash = ?)
      `).bind(now, reset.user_id, reset.user_id, newHash),
    ]);

    if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
      throw new LocalCredentialMutationError("reset_token_invalid");
    }
  }

  private boundPasswordForVerification(password: string): string {
    const normalized = normalizePasswordForHashing(password);
    if (codePointLength(normalized) > MAX_PASSWORD_VERIFY_CODE_POINTS) {
      return "invalid-password-input";
    }
    return normalized;
  }

  private async burnBoundedPassword(password: string): Promise<void> {
    await this.hasher.burn(this.boundPasswordForVerification(password));
  }
}
