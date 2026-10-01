import {
  DEFAULT_SESSION_POLICY,
  createSessionCookie,
  generateSessionToken,
  hashSessionToken,
  readSessionToken,
  type SessionPolicy,
} from "./application-session";

export type SessionRotationFailureReason =
  | "session_missing_or_invalid"
  | "session_state_changed"
  | "rotation_integrity_error";

export class SessionRotationError extends Error {
  constructor(
    readonly reason: SessionRotationFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "SessionRotationError";
  }
}

export interface RotatedApplicationSession {
  readonly userId: string;
  readonly expiresAt: string;
  readonly setCookie: string;
}

interface RotationSessionRow {
  userId: string;
  expiresAt: string;
  lastSeenAt: string | null;
}

const changesOf = (result: D1Result<unknown>): number =>
  typeof result.meta?.changes === "number" ? result.meta.changes : 0;

const assertValidPolicy = (policy: SessionPolicy) => {
  if (
    !Number.isInteger(policy.idleTimeoutSeconds) ||
    policy.idleTimeoutSeconds <= 0 ||
    !Number.isInteger(policy.touchIntervalSeconds) ||
    policy.touchIntervalSeconds <= 0 ||
    policy.touchIntervalSeconds >= policy.idleTimeoutSeconds
  ) {
    throw new SessionRotationError(
      "rotation_integrity_error",
      "Invalid session rotation policy",
    );
  }
};

export const rotateApplicationSession = async (
  request: Request,
  db: D1Database,
  now = new Date(),
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
): Promise<RotatedApplicationSession> => {
  assertValidPolicy(policy);

  const token = readSessionToken(request);
  if (!token) {
    throw new SessionRotationError(
      "session_missing_or_invalid",
      "Current application session is required",
    );
  }

  const currentTokenHash = await hashSessionToken(token);
  const row = await db
    .prepare(
      `SELECT s.user_id AS userId,
              s.expires_at AS expiresAt,
              s.last_seen_at AS lastSeenAt
         FROM application_sessions s
         JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=?
          AND s.revoked_at IS NULL`,
    )
    .bind(currentTokenHash)
    .first<RotationSessionRow>();

  if (!row?.lastSeenAt) {
    throw new SessionRotationError(
      "session_missing_or_invalid",
      "Current application session is invalid",
    );
  }

  const nowMs = now.getTime();
  const expiresAtMs = Date.parse(row.expiresAt);
  const lastSeenAtMs = Date.parse(row.lastSeenAt);
  const idleCutoffMs = nowMs - policy.idleTimeoutSeconds * 1000;

  if (
    !Number.isFinite(expiresAtMs) ||
    !Number.isFinite(lastSeenAtMs) ||
    expiresAtMs <= nowMs ||
    lastSeenAtMs <= idleCutoffMs
  ) {
    throw new SessionRotationError(
      "session_missing_or_invalid",
      "Current application session is expired or invalid",
    );
  }

  const newToken = generateSessionToken();
  const newTokenHash = await hashSessionToken(newToken);
  const rotatedAt = now.toISOString();

  const [revokeResult, insertResult] = await db.batch([
    db
      .prepare(
        `UPDATE application_sessions
            SET revoked_at=?
          WHERE token_hash=?
            AND user_id=?
            AND revoked_at IS NULL
            AND expires_at=?
            AND last_seen_at=?`,
      )
      .bind(
        rotatedAt,
        currentTokenHash,
        row.userId,
        row.expiresAt,
        row.lastSeenAt,
      ),
    db
      .prepare(
        `INSERT INTO application_sessions(
           token_hash,user_id,expires_at,created_at,last_seen_at
         )
         SELECT ?,?,?,?,?
          WHERE changes()=1`,
      )
      .bind(newTokenHash, row.userId, row.expiresAt, rotatedAt, rotatedAt),
  ]);

  const revoked = changesOf(revokeResult);
  const inserted = changesOf(insertResult);

  if (revoked === 0 && inserted === 0) {
    throw new SessionRotationError(
      "session_state_changed",
      "Current application session changed during rotation",
    );
  }

  if (revoked !== 1 || inserted !== 1) {
    throw new SessionRotationError(
      "rotation_integrity_error",
      "Session rotation batch outcome was inconsistent",
    );
  }

  const remainingTtlSeconds = Math.max(
    1,
    Math.ceil((expiresAtMs - nowMs) / 1000),
  );

  return {
    userId: row.userId,
    expiresAt: row.expiresAt,
    setCookie: createSessionCookie(newToken, remainingTtlSeconds),
  };
};
