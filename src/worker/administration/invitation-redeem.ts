import { hashInvitationToken } from "./invitation";

const MAX_REASON_LENGTH = 200;

const requiredText = (label: string, value: string, maxLength = 128): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${label} must be between 1 and ${maxLength} characters`);
  }
  return normalized;
};

export interface InvitationIdentityPolicy {
  matches(inviteeIdentifier: string, authenticatedUserId: string): boolean | Promise<boolean>;
}

export interface RedeemInvitationInput {
  readonly redeemToken: string;
  readonly authenticatedUserId: string;
  readonly reason: string;
  readonly now?: Date;
}

export type RedeemMembershipKind = "added" | "already_exists";

export interface RedeemedInvitation {
  readonly invitationId: string;
  readonly scopeId: string;
  readonly role: string;
  readonly userId: string;
  readonly redeemedAt: string;
  readonly membershipKind: RedeemMembershipKind;
  readonly reason: string;
}

export type InvitationRedeemErrorReason =
  | "invitation_not_found"
  | "invitation_expired"
  | "invitation_revoked"
  | "invitation_already_redeemed"
  | "authenticated_user_not_active"
  | "invitee_identity_policy_required"
  | "invitee_identity_mismatch"
  | "membership_role_mismatch"
  | "invitation_state_changed"
  | "redeem_integrity_error";

export class InvitationRedeemError extends Error {
  constructor(
    readonly reasonCode: InvitationRedeemErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "InvitationRedeemError";
  }
}

interface InvitationRedeemRow {
  id: string;
  scopeId: string;
  inviteeIdentifier: string | null;
  intendedRole: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

interface ExistingMembershipRow {
  role: string;
}

const changesOf = (result: D1Result<unknown>): number =>
  typeof result.meta?.changes === "number" ? result.meta.changes : 0;

export const redeemInvitation = async (
  db: D1Database,
  input: RedeemInvitationInput,
  identityPolicy?: InvitationIdentityPolicy,
): Promise<RedeemedInvitation> => {
  const redeemToken = requiredText("redeemToken", input.redeemToken, 512);
  const authenticatedUserId = requiredText("authenticatedUserId", input.authenticatedUserId);
  const reason = requiredText("reason", input.reason, MAX_REASON_LENGTH);
  const now = input.now ?? new Date();
  const redeemedAt = now.toISOString();
  const tokenHash = await hashInvitationToken(redeemToken);

  const invitation = await db
    .prepare(
      `SELECT id,
              scope_id AS scopeId,
              invitee_identifier AS inviteeIdentifier,
              intended_role AS intendedRole,
              expires_at AS expiresAt,
              redeemed_at AS redeemedAt,
              revoked_at AS revokedAt
         FROM scope_invitations
        WHERE token_hash=?`,
    )
    .bind(tokenHash)
    .first<InvitationRedeemRow>();

  if (!invitation) {
    throw new InvitationRedeemError("invitation_not_found", "Invitation does not exist");
  }
  if (invitation.revokedAt) {
    throw new InvitationRedeemError("invitation_revoked", "Invitation has been revoked");
  }
  if (invitation.redeemedAt) {
    throw new InvitationRedeemError(
      "invitation_already_redeemed",
      "Invitation has already been redeemed",
    );
  }

  const expiresAtMs = Date.parse(invitation.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    throw new InvitationRedeemError("invitation_expired", "Invitation has expired");
  }

  const user = await db
    .prepare("SELECT id FROM users WHERE id=? AND status='active'")
    .bind(authenticatedUserId)
    .first<{ id: string }>();
  if (!user) {
    throw new InvitationRedeemError(
      "authenticated_user_not_active",
      "Authenticated user is not an active internal user",
    );
  }

  if (invitation.inviteeIdentifier) {
    if (!identityPolicy) {
      throw new InvitationRedeemError(
        "invitee_identity_policy_required",
        "An identity policy is required for a targeted invitation",
      );
    }
    if (!(await identityPolicy.matches(invitation.inviteeIdentifier, authenticatedUserId))) {
      throw new InvitationRedeemError(
        "invitee_identity_mismatch",
        "Authenticated user does not match the invitation target",
      );
    }
  }

  const existingMembership = await db
    .prepare(
      "SELECT role FROM scope_memberships WHERE scope_id=? AND user_id=?",
    )
    .bind(invitation.scopeId, authenticatedUserId)
    .first<ExistingMembershipRow>();

  if (existingMembership && existingMembership.role !== invitation.intendedRole) {
    throw new InvitationRedeemError(
      "membership_role_mismatch",
      "Membership already exists with a different role",
    );
  }

  if (existingMembership) {
    const claim = await db
      .prepare(
        `UPDATE scope_invitations
            SET redeemed_at=?
          WHERE id=?
            AND token_hash=?
            AND revoked_at IS NULL
            AND redeemed_at IS NULL
            AND expires_at>?
            AND EXISTS (
              SELECT 1
                FROM scope_memberships
               WHERE scope_id=? AND user_id=? AND role=?
            )`,
      )
      .bind(
        redeemedAt,
        invitation.id,
        tokenHash,
        redeemedAt,
        invitation.scopeId,
        authenticatedUserId,
        invitation.intendedRole,
      )
      .run();

    if (changesOf(claim) !== 1) {
      throw new InvitationRedeemError(
        "invitation_state_changed",
        "Invitation or membership changed concurrently during redeem",
      );
    }

    return {
      invitationId: invitation.id,
      scopeId: invitation.scopeId,
      role: invitation.intendedRole,
      userId: authenticatedUserId,
      redeemedAt,
      membershipKind: "already_exists",
      reason,
    };
  }

  let results: D1Result<unknown>[];
  try {
    results = await db.batch([
      db
        .prepare(
          `UPDATE scope_invitations
              SET redeemed_at=?
            WHERE id=?
              AND token_hash=?
              AND revoked_at IS NULL
              AND redeemed_at IS NULL
              AND expires_at>?`,
        )
        .bind(redeemedAt, invitation.id, tokenHash, redeemedAt),
      db
        .prepare(
          `INSERT INTO scope_memberships(scope_id,user_id,role,created_at,updated_at)
           SELECT ?,?,?,?,?
            WHERE changes()=1`,
        )
        .bind(
          invitation.scopeId,
          authenticatedUserId,
          invitation.intendedRole,
          redeemedAt,
          redeemedAt,
        ),
    ]);
  } catch (error) {
    const current = await db
      .prepare("SELECT role FROM scope_memberships WHERE scope_id=? AND user_id=?")
      .bind(invitation.scopeId, authenticatedUserId)
      .first<ExistingMembershipRow>();
    if (current && current.role !== invitation.intendedRole) {
      throw new InvitationRedeemError(
        "membership_role_mismatch",
        "Membership changed concurrently to a different role",
      );
    }
    throw error;
  }

  const claimed = changesOf(results[0]);
  const membershipAdded = changesOf(results[1]);

  if (claimed === 0 && membershipAdded === 0) {
    throw new InvitationRedeemError(
      "invitation_state_changed",
      "Invitation changed concurrently during redeem",
    );
  }
  if (claimed !== 1 || membershipAdded !== 1) {
    throw new InvitationRedeemError(
      "redeem_integrity_error",
      "Invitation redeem batch outcome was inconsistent",
    );
  }

  return {
    invitationId: invitation.id,
    scopeId: invitation.scopeId,
    role: invitation.intendedRole,
    userId: authenticatedUserId,
    redeemedAt,
    membershipKind: "added",
    reason,
  };
};
