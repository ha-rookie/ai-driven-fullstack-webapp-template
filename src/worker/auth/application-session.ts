import type { ResolvedApplicationSession } from "./types";

export const SESSION_COOKIE_NAME = "app_session";
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24;
export const DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS = 60 * 30;
export const DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS = 60 * 5;

export interface SessionPolicy {
  readonly idleTimeoutSeconds: number;
  readonly touchIntervalSeconds: number;
}

export interface SessionPolicyConfig {
  readonly idleTimeoutSeconds?: string | number | null;
  readonly touchIntervalSeconds?: string | number | null;
}

export class SessionPolicyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionPolicyConfigurationError";
  }
}

const parsePositiveInteger = (
  value: string | number | null | undefined,
  fallback: number,
  name: string,
): number => {
  if (value === null || value === undefined || value === "") return fallback;

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SessionPolicyConfigurationError(`${name} must be a positive integer`);
  }

  return parsed;
};

export const createSessionPolicy = (
  config: SessionPolicyConfig = {},
): SessionPolicy => {
  const idleTimeoutSeconds = parsePositiveInteger(
    config.idleTimeoutSeconds,
    DEFAULT_SESSION_IDLE_TIMEOUT_SECONDS,
    "Session idle timeout",
  );
  const touchIntervalSeconds = parsePositiveInteger(
    config.touchIntervalSeconds,
    DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS,
    "Session touch interval",
  );

  if (touchIntervalSeconds >= idleTimeoutSeconds) {
    throw new SessionPolicyConfigurationError(
      "Session touch interval must be shorter than idle timeout",
    );
  }

  return { idleTimeoutSeconds, touchIntervalSeconds };
};

export const DEFAULT_SESSION_POLICY = createSessionPolicy();

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const generateSessionToken = () =>
  base64Url(crypto.getRandomValues(new Uint8Array(32)));

export const hashSessionToken = async (token: string) =>
  base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))),
  );

export const readSessionToken = (request: Request): string | null => {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      return valueParts.join("=") || null;
    }
  }

  return null;
};

export const createSessionCookie = (
  token: string,
  maxAgeSeconds = DEFAULT_SESSION_TTL_SECONDS,
) =>
  `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

export const clearSessionCookie = () =>
  `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export interface IssueApplicationSessionOptions {
  now?: Date;
  ttlSeconds?: number;
}

export interface IssuedApplicationSession {
  token: string;
  expiresAt: string;
}

interface SessionLookupRow {
  id: string;
  displayName: string | null;
  expiresAt: string;
  lastSeenAt: string | null;
}

export const issueApplicationSession = async (
  db: D1Database,
  userId: string,
  options: IssueApplicationSessionOptions = {},
): Promise<IssuedApplicationSession> => {
  const now = options.now ?? new Date();
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;

  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Session TTL must be a positive integer");
  }

  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  await db
    .prepare(
      "INSERT INTO application_sessions(token_hash,user_id,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)",
    )
    .bind(tokenHash, userId, expiresAt, issuedAt, issuedAt)
    .run();

  return { token, expiresAt };
};

export const resolveSessionToken = async (
  token: string,
  db: D1Database,
  now = new Date(),
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
): Promise<ResolvedApplicationSession | null> => {
  if (
    !Number.isInteger(policy.idleTimeoutSeconds) ||
    policy.idleTimeoutSeconds <= 0 ||
    !Number.isInteger(policy.touchIntervalSeconds) ||
    policy.touchIntervalSeconds <= 0 ||
    policy.touchIntervalSeconds >= policy.idleTimeoutSeconds
  ) {
    throw new SessionPolicyConfigurationError("Invalid session policy");
  }

  const tokenHash = await hashSessionToken(token);
  const row = await db
    .prepare(
      "SELECT u.id,u.display_name AS displayName,s.expires_at AS expiresAt,s.last_seen_at AS lastSeenAt FROM application_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND u.status='active'",
    )
    .bind(tokenHash)
    .first<SessionLookupRow>();

  if (!row?.lastSeenAt) return null;

  const nowMs = now.getTime();
  const expiresAtMs = Date.parse(row.expiresAt);
  const lastSeenAtMs = Date.parse(row.lastSeenAt);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(lastSeenAtMs)) return null;

  if (expiresAtMs <= nowMs) return null;

  const idleCutoffMs = nowMs - policy.idleTimeoutSeconds * 1000;
  if (lastSeenAtMs <= idleCutoffMs) return null;

  const touchCutoffMs = nowMs - policy.touchIntervalSeconds * 1000;
  if (lastSeenAtMs <= touchCutoffMs) {
    const nowIso = now.toISOString();
    await db
      .prepare(
        "UPDATE application_sessions SET last_seen_at=? WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? AND last_seen_at=?",
      )
      .bind(nowIso, tokenHash, nowIso, row.lastSeenAt)
      .run();
  }

  return {
    user: { id: row.id, displayName: row.displayName },
    expiresAt: row.expiresAt,
  };
};

export const resolveApplicationSession = async (
  request: Request,
  db: D1Database,
  now = new Date(),
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
) => {
  const token = readSessionToken(request);
  return token ? resolveSessionToken(token, db, now, policy) : null;
};

export const revokeApplicationSession = async (
  request: Request,
  db: D1Database,
  now = new Date(),
) => {
  const token = readSessionToken(request);
  if (!token) return false;

  const tokenHash = await hashSessionToken(token);
  const result = await db
    .prepare(
      "UPDATE application_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",
    )
    .bind(now.toISOString(), tokenHash)
    .run();

  return result.meta.changes === 1;
};
