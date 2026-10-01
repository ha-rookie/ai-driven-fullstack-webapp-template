import {
  DEFAULT_SESSION_POLICY,
  hashSessionToken,
  type SessionPolicy,
} from "./application-session";

export const DEFAULT_ACTIVE_SESSION_LIMIT = 20;
export const MAX_ACTIVE_SESSION_LIMIT = 100;

export interface ActiveSessionQueryOptions {
  readonly now?: Date;
  readonly limit?: number;
  /** Raw token is accepted only to identify the caller's current session. It is never returned. */
  readonly currentSessionToken?: string | null;
  readonly sessionPolicy?: SessionPolicy;
}

export interface ActiveSessionView {
  /** Opaque display identifier derived from the stored token hash, never the token hash itself. */
  readonly sessionId: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly current: boolean;
}

interface ActiveSessionRow {
  readonly tokenHash: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
}

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const publicSessionId = async (tokenHash: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`session-id:v1:${tokenHash}`),
  );
  return `sid_v1_${base64Url(new Uint8Array(digest))}`;
};

const validateLimit = (limit: number): void => {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIVE_SESSION_LIMIT) {
    throw new Error(
      `Active session limit must be an integer between 1 and ${MAX_ACTIVE_SESSION_LIMIT}`,
    );
  }
};

const validatePolicy = (policy: SessionPolicy): void => {
  if (
    !Number.isInteger(policy.idleTimeoutSeconds) ||
    policy.idleTimeoutSeconds <= 0 ||
    !Number.isInteger(policy.touchIntervalSeconds) ||
    policy.touchIntervalSeconds <= 0 ||
    policy.touchIntervalSeconds >= policy.idleTimeoutSeconds
  ) {
    throw new Error("Invalid session policy");
  }
};

/**
 * Returns a bounded read model of currently usable application sessions.
 *
 * Authorization is intentionally not performed here. Callers must enforce the
 * appropriate self/admin authorization boundary before invoking this service.
 */
export const queryActiveApplicationSessionsForUser = async (
  db: D1Database,
  userId: string,
  options: ActiveSessionQueryOptions = {},
): Promise<readonly ActiveSessionView[]> => {
  if (!userId.trim()) throw new Error("User id is required");

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid query time");

  const limit = options.limit ?? DEFAULT_ACTIVE_SESSION_LIMIT;
  validateLimit(limit);

  const policy = options.sessionPolicy ?? DEFAULT_SESSION_POLICY;
  validatePolicy(policy);

  const nowIso = now.toISOString();
  const idleCutoffIso = new Date(
    now.getTime() - policy.idleTimeoutSeconds * 1000,
  ).toISOString();

  const result = await db
    .prepare(
      "SELECT s.token_hash AS tokenHash,s.created_at AS createdAt,s.last_seen_at AS lastSeenAt,s.expires_at AS expiresAt FROM application_sessions s JOIN users u ON u.id=s.user_id WHERE s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND u.status='active' ORDER BY s.last_seen_at DESC,s.created_at DESC LIMIT ?",
    )
    .bind(userId, nowIso, idleCutoffIso, limit)
    .all<ActiveSessionRow>();

  const currentTokenHash = options.currentSessionToken
    ? await hashSessionToken(options.currentSessionToken)
    : null;

  return Promise.all(
    result.results.map(async (row) => ({
      sessionId: await publicSessionId(row.tokenHash),
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      current: currentTokenHash !== null && row.tokenHash === currentTokenHash,
    })),
  );
};
