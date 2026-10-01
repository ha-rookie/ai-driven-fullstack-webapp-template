import type { ScopeMembership } from "../authorization";

const MAX_REASON_LENGTH = 200;

export type MembershipMutationKind = "added" | "already_exists" | "removed";

export interface MembershipMutationContext {
  readonly actorId: string;
  readonly reason: string;
  readonly now?: Date;
}

export interface AddScopeMembershipInput extends MembershipMutationContext {
  readonly userId: string;
  readonly scopeId: string;
  readonly role: string;
}

export interface RemoveScopeMembershipInput extends MembershipMutationContext {
  readonly userId: string;
  readonly scopeId: string;
}

export interface MembershipMutationResult {
  readonly kind: MembershipMutationKind;
  readonly actorId: string;
  readonly targetUserId: string;
  readonly scopeId: string;
  readonly role: string;
  readonly reason: string;
  readonly changedAt: string;
}

export type MembershipMutationRejectReason =
  | "user_not_found"
  | "scope_not_found"
  | "membership_not_found"
  | "membership_role_mismatch";

export class MembershipMutationError extends Error {
  constructor(
    readonly reasonCode: MembershipMutationRejectReason,
    message: string,
  ) {
    super(message);
    this.name = "MembershipMutationError";
  }
}

interface ExistingMembershipRow {
  scopeId: string;
  userId: string;
  role: string;
}

const requiredText = (label: string, value: string, maxLength = 128): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${label} must be between 1 and ${maxLength} characters`);
  }
  return normalized;
};

const normalizeContext = (context: MembershipMutationContext) => ({
  actorId: requiredText("actorId", context.actorId),
  reason: requiredText("reason", context.reason, MAX_REASON_LENGTH),
  now: context.now ?? new Date(),
});

const assertUserExists = async (db: D1Database, userId: string): Promise<void> => {
  const row = await db
    .prepare("SELECT id FROM users WHERE id=?")
    .bind(userId)
    .first<{ id: string }>();
  if (!row) {
    throw new MembershipMutationError("user_not_found", "Target user does not exist");
  }
};

const assertScopeExists = async (db: D1Database, scopeId: string): Promise<void> => {
  const row = await db
    .prepare("SELECT id FROM resource_scopes WHERE id=?")
    .bind(scopeId)
    .first<{ id: string }>();
  if (!row) {
    throw new MembershipMutationError("scope_not_found", "Target scope does not exist");
  }
};

const findMembership = async (
  db: D1Database,
  userId: string,
  scopeId: string,
): Promise<ScopeMembership | null> =>
  db
    .prepare(
      "SELECT scope_id AS scopeId,user_id AS userId,role FROM scope_memberships WHERE user_id=? AND scope_id=?",
    )
    .bind(userId, scopeId)
    .first<ExistingMembershipRow>();

export const addScopeMembership = async (
  db: D1Database,
  input: AddScopeMembershipInput,
): Promise<MembershipMutationResult> => {
  const userId = requiredText("userId", input.userId);
  const scopeId = requiredText("scopeId", input.scopeId);
  const role = requiredText("role", input.role, 64);
  const { actorId, reason, now } = normalizeContext(input);

  await assertUserExists(db, userId);
  await assertScopeExists(db, scopeId);

  const changedAt = now.toISOString();
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO scope_memberships(scope_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?)",
    )
    .bind(scopeId, userId, role, changedAt, changedAt)
    .run();

  if (result.meta.changes === 1) {
    return {
      kind: "added",
      actorId,
      targetUserId: userId,
      scopeId,
      role,
      reason,
      changedAt,
    };
  }

  const existing = await findMembership(db, userId, scopeId);
  if (!existing) {
    throw new MembershipMutationError(
      "membership_not_found",
      "Membership insert was not applied and no membership exists",
    );
  }
  if (existing.role !== role) {
    throw new MembershipMutationError(
      "membership_role_mismatch",
      "Membership already exists with a different role; use the role-change service",
    );
  }

  return {
    kind: "already_exists",
    actorId,
    targetUserId: userId,
    scopeId,
    role: existing.role,
    reason,
    changedAt,
  };
};

export const removeScopeMembership = async (
  db: D1Database,
  input: RemoveScopeMembershipInput,
): Promise<MembershipMutationResult> => {
  const userId = requiredText("userId", input.userId);
  const scopeId = requiredText("scopeId", input.scopeId);
  const { actorId, reason, now } = normalizeContext(input);

  await assertUserExists(db, userId);
  await assertScopeExists(db, scopeId);

  const existing = await findMembership(db, userId, scopeId);
  if (!existing) {
    throw new MembershipMutationError("membership_not_found", "Membership does not exist");
  }

  const result = await db
    .prepare("DELETE FROM scope_memberships WHERE user_id=? AND scope_id=? AND role=?")
    .bind(userId, scopeId, existing.role)
    .run();

  if (result.meta.changes !== 1) {
    throw new MembershipMutationError(
      "membership_not_found",
      "Membership changed concurrently and was not removed",
    );
  }

  return {
    kind: "removed",
    actorId,
    targetUserId: userId,
    scopeId,
    role: existing.role,
    reason,
    changedAt: now.toISOString(),
  };
};
