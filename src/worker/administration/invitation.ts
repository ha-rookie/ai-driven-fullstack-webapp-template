const MAX_REASON_LENGTH = 200;
const MAX_ROLE_LENGTH = 64;
const MAX_INVITEE_IDENTIFIER_LENGTH = 320;
export const DEFAULT_INVITATION_TTL_SECONDS = 60 * 60 * 24 * 7;

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const generateInvitationToken = () =>
  base64Url(crypto.getRandomValues(new Uint8Array(32)));

export const hashInvitationToken = async (token: string) =>
  base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))),
  );

const requiredText = (label: string, value: string, maxLength = 128): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${label} must be between 1 and ${maxLength} characters`);
  }
  return normalized;
};

const optionalText = (
  label: string,
  value: string | null | undefined,
  maxLength: number,
): string | null => {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new TypeError(`${label} must be at most ${maxLength} characters`);
  }
  return normalized;
};

export interface InvitationRolePolicy {
  isAllowed(role: string, scopeId: string): boolean | Promise<boolean>;
}

export type InvitationState = "open" | "expired" | "redeemed" | "revoked";

export interface InvitationSummary {
  readonly id: string;
  readonly scopeId: string;
  readonly inviteeIdentifier: string | null;
  readonly intendedRole: string;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly redeemedAt: string | null;
  readonly revokedAt: string | null;
  readonly state: InvitationState;
}

export interface IssueInvitationInput {
  readonly actorId: string;
  readonly scopeId: string;
  readonly intendedRole: string;
  readonly inviteeIdentifier?: string | null;
  readonly reason: string;
  readonly ttlSeconds?: number;
  readonly now?: Date;
}

export interface IssuedInvitation {
  readonly invitation: InvitationSummary;
  readonly redeemToken: string;
  readonly reason: string;
}

export interface RevokeInvitationInput {
  readonly actorId: string;
  readonly invitationId: string;
  readonly reason: string;
  readonly now?: Date;
}

export interface RevokedInvitation {
  readonly invitation: InvitationSummary;
  readonly actorId: string;
  readonly reason: string;
}

export type InvitationErrorReason =
  | "scope_not_found"
  | "invalid_role"
  | "invitation_already_open"
  | "invitation_not_found"
  | "invitation_not_open"
  | "invitation_state_changed";

export class InvitationError extends Error {
  constructor(
    readonly reasonCode: InvitationErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

interface InvitationRow {
  id: string;
  scopeId: string;
  inviteeIdentifier: string | null;
  intendedRole: string;
  issuedBy: string;
  issuedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}

const classifyState = (row: InvitationRow, now: Date): InvitationState => {
  if (row.revokedAt) return "revoked";
  if (row.redeemedAt) return "redeemed";
  const expiresAtMs = Date.parse(row.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) return "expired";
  return "open";
};

const toSummary = (row: InvitationRow, now: Date): InvitationSummary => ({
  ...row,
  state: classifyState(row, now),
});

const selectColumns = `id,
  scope_id AS scopeId,
  invitee_identifier AS inviteeIdentifier,
  intended_role AS intendedRole,
  issued_by AS issuedBy,
  issued_at AS issuedAt,
  expires_at AS expiresAt,
  redeemed_at AS redeemedAt,
  revoked_at AS revokedAt`;

export const findInvitationById = async (
  db: D1Database,
  invitationId: string,
  now = new Date(),
): Promise<InvitationSummary | null> => {
  const id = requiredText("invitationId", invitationId);
  const row = await db
    .prepare(`SELECT ${selectColumns} FROM scope_invitations WHERE id=?`)
    .bind(id)
    .first<InvitationRow>();
  return row ? toSummary(row, now) : null;
};

export const issueInvitation = async (
  db: D1Database,
  input: IssueInvitationInput,
  rolePolicy: InvitationRolePolicy,
): Promise<IssuedInvitation> => {
  const actorId = requiredText("actorId", input.actorId);
  const scopeId = requiredText("scopeId", input.scopeId);
  const intendedRole = requiredText("intendedRole", input.intendedRole, MAX_ROLE_LENGTH);
  const inviteeIdentifier = optionalText(
    "inviteeIdentifier",
    input.inviteeIdentifier,
    MAX_INVITEE_IDENTIFIER_LENGTH,
  );
  const reason = requiredText("reason", input.reason, MAX_REASON_LENGTH);
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_INVITATION_TTL_SECONDS;
  const now = input.now ?? new Date();

  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError("ttlSeconds must be a positive integer");
  }

  const scope = await db
    .prepare("SELECT id FROM resource_scopes WHERE id=?")
    .bind(scopeId)
    .first<{ id: string }>();
  if (!scope) {
    throw new InvitationError("scope_not_found", "Target scope does not exist");
  }

  if (!(await rolePolicy.isAllowed(intendedRole, scopeId))) {
    throw new InvitationError("invalid_role", "Intended role is not allowed for this scope");
  }

  const nowIso = now.toISOString();
  const existing = await db
    .prepare(
      `SELECT ${selectColumns}
         FROM scope_invitations
        WHERE scope_id=?
          AND ((invitee_identifier IS NULL AND ? IS NULL) OR invitee_identifier=?)
          AND intended_role=?
          AND revoked_at IS NULL
          AND redeemed_at IS NULL
          AND expires_at>?
        LIMIT 1`,
    )
    .bind(scopeId, inviteeIdentifier, inviteeIdentifier, intendedRole, nowIso)
    .first<InvitationRow>();

  if (existing) {
    throw new InvitationError(
      "invitation_already_open",
      "An open invitation already exists for the same scope, invitee and role",
    );
  }

  const redeemToken = generateInvitationToken();
  const tokenHash = await hashInvitationToken(redeemToken);
  const invitationId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO scope_invitations(
         id,token_hash,scope_id,invitee_identifier,intended_role,issued_by,
         issued_at,expires_at,redeemed_at,revoked_at
       ) VALUES(?,?,?,?,?,?,?,?,NULL,NULL)`,
    )
    .bind(
      invitationId,
      tokenHash,
      scopeId,
      inviteeIdentifier,
      intendedRole,
      actorId,
      nowIso,
      expiresAt,
    )
    .run();

  return {
    invitation: {
      id: invitationId,
      scopeId,
      inviteeIdentifier,
      intendedRole,
      issuedBy: actorId,
      issuedAt: nowIso,
      expiresAt,
      redeemedAt: null,
      revokedAt: null,
      state: "open",
    },
    redeemToken,
    reason,
  };
};

export const revokeInvitation = async (
  db: D1Database,
  input: RevokeInvitationInput,
): Promise<RevokedInvitation> => {
  const actorId = requiredText("actorId", input.actorId);
  const invitationId = requiredText("invitationId", input.invitationId);
  const reason = requiredText("reason", input.reason, MAX_REASON_LENGTH);
  const now = input.now ?? new Date();

  const current = await findInvitationById(db, invitationId, now);
  if (!current) {
    throw new InvitationError("invitation_not_found", "Invitation does not exist");
  }
  if (current.state !== "open") {
    throw new InvitationError("invitation_not_open", "Only an open invitation can be revoked");
  }

  const revokedAt = now.toISOString();
  const result = await db
    .prepare(
      `UPDATE scope_invitations
          SET revoked_at=?
        WHERE id=?
          AND revoked_at IS NULL
          AND redeemed_at IS NULL
          AND expires_at>?`,
    )
    .bind(revokedAt, invitationId, revokedAt)
    .run();

  if (result.meta.changes !== 1) {
    throw new InvitationError(
      "invitation_state_changed",
      "Invitation changed concurrently and was not revoked",
    );
  }

  return {
    actorId,
    reason,
    invitation: {
      ...current,
      revokedAt,
      state: "revoked",
    },
  };
};
