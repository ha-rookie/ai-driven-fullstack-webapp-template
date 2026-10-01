import { hashSessionToken, readSessionToken } from "./application-session";

export type SessionRevocationMode = "all" | "others";

export interface SessionRevocationResult {
  readonly userId: string;
  readonly mode: SessionRevocationMode;
  readonly revokedCount: number;
}

export class SessionRevocationCurrentSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionRevocationCurrentSessionError";
  }
}

interface SessionOwnerRow {
  userId: string;
}

const changesOf = (result: D1Result<unknown>): number =>
  typeof result.meta?.changes === "number" ? result.meta.changes : 0;

export const revokeAllApplicationSessionsForUser = async (
  db: D1Database,
  userId: string,
  now = new Date(),
): Promise<SessionRevocationResult> => {
  const result = await db
    .prepare(
      "UPDATE application_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
    )
    .bind(now.toISOString(), userId)
    .run();

  return {
    userId,
    mode: "all",
    revokedCount: changesOf(result),
  };
};

export const revokeOtherApplicationSessionsForUser = async (
  request: Request,
  db: D1Database,
  userId: string,
  now = new Date(),
): Promise<SessionRevocationResult> => {
  const token = readSessionToken(request);
  if (!token) {
    throw new SessionRevocationCurrentSessionError(
      "Current application session is required",
    );
  }

  const tokenHash = await hashSessionToken(token);
  const owner = await db
    .prepare(
      "SELECT user_id AS userId FROM application_sessions WHERE token_hash=? AND revoked_at IS NULL",
    )
    .bind(tokenHash)
    .first<SessionOwnerRow>();

  if (owner?.userId !== userId) {
    throw new SessionRevocationCurrentSessionError(
      "Current application session does not belong to target user",
    );
  }

  const result = await db
    .prepare(
      "UPDATE application_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND token_hash<>?",
    )
    .bind(now.toISOString(), userId, tokenHash)
    .run();

  return {
    userId,
    mode: "others",
    revokedCount: changesOf(result),
  };
};
