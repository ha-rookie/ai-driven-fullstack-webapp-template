import { revokeAllApplicationSessionsForUser } from "./session-revocation";
import type { UserRecord, UserStatus, VerifiedExternalIdentity } from "./types";

const MAX_REASON_LENGTH = 200;

export interface UserLifecycleContext {
  readonly actorId: string;
  readonly reason: string;
  readonly now?: Date;
}

export interface UserLifecycleTransitionResult {
  readonly userId: string;
  readonly previousStatus: UserStatus;
  readonly nextStatus: UserStatus;
  readonly actorId: string;
  readonly reason: string;
  readonly changedAt: string;
  readonly revokedSessionCount: number;
}

export class UserLifecycleTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserLifecycleTransitionError";
  }
}

interface ExternalIdentityUserRow {
  id: string;
  displayName: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

const changesOf = (result: D1Result<unknown>): number =>
  typeof result.meta?.changes === "number" ? result.meta.changes : 0;

const validateContext = (context: UserLifecycleContext) => {
  if (!context.actorId.trim()) {
    throw new UserLifecycleTransitionError("Lifecycle actor is required");
  }

  const reason = context.reason.trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    throw new UserLifecycleTransitionError(
      `Lifecycle reason must be between 1 and ${MAX_REASON_LENGTH} characters`,
    );
  }

  return reason;
};

export const resolveActiveUserForExternalIdentity = async (
  db: D1Database,
  identity: Pick<VerifiedExternalIdentity, "provider" | "subject">,
): Promise<UserRecord | null> => {
  const row = await db
    .prepare(
      "SELECT u.id,u.display_name AS displayName,u.status,u.created_at AS createdAt,u.updated_at AS updatedAt FROM external_identities e JOIN users u ON u.id=e.user_id WHERE e.provider=? AND e.provider_subject=?",
    )
    .bind(identity.provider, identity.subject)
    .first<ExternalIdentityUserRow>();

  if (!row || row.status !== "active") return null;
  return row;
};

export const disableUser = async (
  db: D1Database,
  userId: string,
  context: UserLifecycleContext,
): Promise<UserLifecycleTransitionResult> => {
  const reason = validateContext(context);
  const now = context.now ?? new Date();
  const changedAt = now.toISOString();

  const update = await db
    .prepare(
      "UPDATE users SET status='disabled',updated_at=? WHERE id=? AND status='active'",
    )
    .bind(changedAt, userId)
    .run();

  if (changesOf(update) !== 1) {
    throw new UserLifecycleTransitionError("User disable transition rejected");
  }

  const revocation = await revokeAllApplicationSessionsForUser(db, userId, now);

  return {
    userId,
    previousStatus: "active",
    nextStatus: "disabled",
    actorId: context.actorId,
    reason,
    changedAt,
    revokedSessionCount: revocation.revokedCount,
  };
};

export const reactivateUser = async (
  db: D1Database,
  userId: string,
  context: UserLifecycleContext,
): Promise<UserLifecycleTransitionResult> => {
  const reason = validateContext(context);
  const now = context.now ?? new Date();
  const changedAt = now.toISOString();

  const update = await db
    .prepare(
      "UPDATE users SET status='active',updated_at=? WHERE id=? AND status='disabled'",
    )
    .bind(changedAt, userId)
    .run();

  if (changesOf(update) !== 1) {
    throw new UserLifecycleTransitionError("User reactivate transition rejected");
  }

  return {
    userId,
    previousStatus: "disabled",
    nextStatus: "active",
    actorId: context.actorId,
    reason,
    changedAt,
    revokedSessionCount: 0,
  };
};
