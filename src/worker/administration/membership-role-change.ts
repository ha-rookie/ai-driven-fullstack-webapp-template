const MAX_REASON_LENGTH = 200;

export type MembershipRoleChangeKind = "changed" | "unchanged";

export interface MembershipRolePolicy {
  isValidRole(role: string): boolean;
}

export interface MembershipRoleChangeInput {
  readonly actorId: string;
  readonly userId: string;
  readonly scopeId: string;
  readonly nextRole: string;
  readonly reason: string;
  readonly now?: Date;
}

export interface MembershipRoleChangeResult {
  readonly kind: MembershipRoleChangeKind;
  readonly actorId: string;
  readonly targetUserId: string;
  readonly scopeId: string;
  readonly previousRole: string;
  readonly nextRole: string;
  readonly reason: string;
  readonly changedAt: string;
}

export type MembershipRoleChangeRejectReason =
  | "membership_not_found"
  | "invalid_role"
  | "membership_changed_concurrently";

export class MembershipRoleChangeError extends Error {
  constructor(
    readonly reasonCode: MembershipRoleChangeRejectReason,
    message: string,
  ) {
    super(message);
    this.name = "MembershipRoleChangeError";
  }
}

interface MembershipRow {
  role: string;
}

const requiredText = (label: string, value: string, maxLength = 128): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${label} must be between 1 and ${maxLength} characters`);
  }
  return normalized;
};

export const changeMembershipRole = async (
  db: D1Database,
  policy: MembershipRolePolicy,
  input: MembershipRoleChangeInput,
): Promise<MembershipRoleChangeResult> => {
  const actorId = requiredText("actorId", input.actorId);
  const userId = requiredText("userId", input.userId);
  const scopeId = requiredText("scopeId", input.scopeId);
  const nextRole = requiredText("nextRole", input.nextRole, 64);
  const reason = requiredText("reason", input.reason, MAX_REASON_LENGTH);
  const changedAt = (input.now ?? new Date()).toISOString();

  if (!policy.isValidRole(nextRole)) {
    throw new MembershipRoleChangeError("invalid_role", "Role is not allowed by project policy");
  }

  const existing = await db
    .prepare("SELECT role FROM scope_memberships WHERE user_id=? AND scope_id=?")
    .bind(userId, scopeId)
    .first<MembershipRow>();

  if (!existing) {
    throw new MembershipRoleChangeError("membership_not_found", "Membership does not exist");
  }

  if (existing.role === nextRole) {
    return {
      kind: "unchanged",
      actorId,
      targetUserId: userId,
      scopeId,
      previousRole: existing.role,
      nextRole,
      reason,
      changedAt,
    };
  }

  const result = await db
    .prepare(
      "UPDATE scope_memberships SET role=?, updated_at=? WHERE user_id=? AND scope_id=? AND role=?",
    )
    .bind(nextRole, changedAt, userId, scopeId, existing.role)
    .run();

  if (result.meta.changes !== 1) {
    throw new MembershipRoleChangeError(
      "membership_changed_concurrently",
      "Membership role changed concurrently; reload before retrying",
    );
  }

  return {
    kind: "changed",
    actorId,
    targetUserId: userId,
    scopeId,
    previousRole: existing.role,
    nextRole,
    reason,
    changedAt,
  };
};
