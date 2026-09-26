import type { ResolvedApplicationSession } from "./types";

export const SESSION_COOKIE_NAME = "app_session";
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24;

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
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  await db
    .prepare(
      "INSERT INTO application_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
    )
    .bind(tokenHash, userId, expiresAt, now.toISOString())
    .run();

  return { token, expiresAt };
};

export const resolveSessionToken = async (
  token: string,
  db: D1Database,
  now = new Date(),
): Promise<ResolvedApplicationSession | null> => {
  const tokenHash = await hashSessionToken(token);
  const row = await db
    .prepare(
      "SELECT u.id,u.display_name AS displayName,s.expires_at AS expiresAt FROM application_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?",
    )
    .bind(tokenHash, now.toISOString())
    .first<SessionLookupRow>();

  return row
    ? {
        user: { id: row.id, displayName: row.displayName },
        expiresAt: row.expiresAt,
      }
    : null;
};

export const resolveApplicationSession = async (
  request: Request,
  db: D1Database,
  now = new Date(),
) => {
  const token = readSessionToken(request);
  return token ? resolveSessionToken(token, db, now) : null;
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
