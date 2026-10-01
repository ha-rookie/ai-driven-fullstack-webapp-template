import {
  MembershipMutationError,
  type MembershipMutationResult,
  type RemoveScopeMembershipInput,
} from "./membership-management";
import {
  MembershipRoleChangeError,
  type MembershipRoleChangeInput,
  type MembershipRoleChangeResult,
  type MembershipRolePolicy,
} from "./membership-role-change";

const MAX_ROLE_LENGTH = 64;

export interface PrivilegedMembershipPolicy {
  getPrivilegedRoles(scopeId: string): readonly string[] | Promise<readonly string[]>;
}

export type PrivilegedMembershipSafetyRejectReason =
  | "privileged_role_policy_invalid"
  | "self_privileged_membership_change_denied"
  | "last_privileged_membership";

export class PrivilegedMembershipSafetyError extends Error {
  constructor(
    readonly reasonCode: PrivilegedMembershipSafetyRejectReason,
    message: string,
  ) {
    super(message);
    this.name = "PrivilegedMembershipSafetyError";
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

const resolvePrivilegedRoles = async (
  policy: PrivilegedMembershipPolicy,
  scopeId: string,
): Promise<string[]> => {
  const supplied = await policy.getPrivilegedRoles(scopeId);
  const roles = [...new Set(supplied.map((role) => role.trim()))];
  if (
    roles.length === 0 ||
    roles.some((role) => !role || role.length > MAX_ROLE_LENGTH)
  ) {
    throw new PrivilegedMembershipSafetyError(
      "privileged_role_policy_invalid",
      "Privileged role policy must provide at least one valid role",
    );
  }
  return roles;
};

const isPrivileged = (role: string, privilegedRoles: readonly string[]) =>
  privilegedRoles.includes(role);

const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(",");

const readMembership = async (
  db: D1Database,
  userId: string,
  scopeId: string,
): Promise<MembershipRow | null> =>
  db
    .prepare("SELECT role FROM scope_memberships WHERE user_id=? AND scope_id=?")
    .bind(userId, scopeId)
    .first<MembershipRow>();

export const removeScopeMembershipSafely = async (
  db: D1Database,
  policy: PrivilegedMembershipPolicy,
  input: RemoveScopeMembershipInput,
): Promise<MembershipMutationResult> => {
  const actorId = requiredText("actorId", input.actorId);
  const userId = requiredText("userId", input.userId);
  const scopeId = requiredText("scopeId", input.scopeId);
  const reason = requiredText("reason", input.reason, 200);
  const changedAt = (input.now ?? new Date()).toISOString();

  const existing = await readMembership(db, userId, scopeId);
  if (!existing) {
    throw new MembershipMutationError("membership_not_found", "Membership does not exist");
  }

  const privilegedRoles = await resolvePrivilegedRoles(policy, scopeId);
  if (!isPrivileged(existing.role, privilegedRoles)) {
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
      changedAt,
    };
  }

  if (actorId === userId) {
    throw new PrivilegedMembershipSafetyError(
      "self_privileged_membership_change_denied",
      "A privileged membership cannot remove itself",
    );
  }

  const roleMarks = placeholders(privilegedRoles.length);
  const result = await db
    .prepare(
      `DELETE FROM scope_memberships
        WHERE user_id=?
          AND scope_id=?
          AND role=?
          AND EXISTS (
            SELECT 1
              FROM scope_memberships other
             WHERE other.scope_id=?
               AND other.user_id<>?
               AND other.role IN (${roleMarks})
          )`,
    )
    .bind(userId, scopeId, existing.role, scopeId, userId, ...privilegedRoles)
    .run();

  if (result.meta.changes !== 1) {
    const current = await readMembership(db, userId, scopeId);
    if (!current || current.role !== existing.role) {
      throw new MembershipMutationError(
        "membership_not_found",
        "Membership changed concurrently and was not removed",
      );
    }
    throw new PrivilegedMembershipSafetyError(
      "last_privileged_membership",
      "Removing this membership would leave the scope without privileged membership",
    );
  }

  return {
    kind: "removed",
    actorId,
    targetUserId: userId,
    scopeId,
    role: existing.role,
    reason,
    changedAt,
  };
};

export const changeMembershipRoleSafely = async (
  db: D1Database,
  rolePolicy: MembershipRolePolicy,
  privilegedPolicy: PrivilegedMembershipPolicy,
  input: MembershipRoleChangeInput,
): Promise<MembershipRoleChangeResult> => {
  const actorId = requiredText("actorId", input.actorId);
  const userId = requiredText("userId", input.userId);
  const scopeId = requiredText("scopeId", input.scopeId);
  const nextRole = requiredText("nextRole", input.nextRole, MAX_ROLE_LENGTH);
  const reason = requiredText("reason", input.reason, 200);
  const changedAt = (input.now ?? new Date()).toISOString();

  if (!rolePolicy.isValidRole(nextRole)) {
    throw new MembershipRoleChangeError("invalid_role", "Role is not allowed by project policy");
  }

  const existing = await readMembership(db, userId, scopeId);
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

  const privilegedRoles = await resolvePrivilegedRoles(privilegedPolicy, scopeId);
  const losesPrivilege =
    isPrivileged(existing.role, privilegedRoles) && !isPrivileged(nextRole, privilegedRoles);

  if (losesPrivilege && actorId === userId) {
    throw new PrivilegedMembershipSafetyError(
      "self_privileged_membership_change_denied",
      "A privileged membership cannot downgrade itself",
    );
  }

  let result: D1Result<unknown>;
  if (losesPrivilege) {
    const roleMarks = placeholders(privilegedRoles.length);
    result = await db
      .prepare(
        `UPDATE scope_memberships
            SET role=?, updated_at=?
          WHERE user_id=?
            AND scope_id=?
            AND role=?
            AND EXISTS (
              SELECT 1
                FROM scope_memberships other
               WHERE other.scope_id=?
                 AND other.user_id<>?
                 AND other.role IN (${roleMarks})
            )`,
      )
      .bind(
        nextRole,
        changedAt,
        userId,
        scopeId,
        existing.role,
        scopeId,
        userId,
        ...privilegedRoles,
      )
      .run();
  } else {
    result = await db
      .prepare(
        "UPDATE scope_memberships SET role=?, updated_at=? WHERE user_id=? AND scope_id=? AND role=?",
      )
      .bind(nextRole, changedAt, userId, scopeId, existing.role)
      .run();
  }

  if (result.meta.changes !== 1) {
    const current = await readMembership(db, userId, scopeId);
    if (!current || current.role !== existing.role) {
      throw new MembershipRoleChangeError(
        "membership_changed_concurrently",
        "Membership role changed concurrently; reload before retrying",
      );
    }
    if (losesPrivilege) {
      throw new PrivilegedMembershipSafetyError(
        "last_privileged_membership",
        "Changing this role would leave the scope without privileged membership",
      );
    }
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
