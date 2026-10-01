import type { IssuedInvitation, RevokedInvitation } from "../administration";
import type { AuditEvent, RequestContext } from "./types";

export interface InvitationAuditContext {
  readonly event: AuditEvent;
  readonly invitationId: string;
  readonly intendedRole: string;
  readonly expiresAt: string;
  readonly inviteeIdentifier: string | null;
}

export const createInvitationIssuedAuditContext = (
  requestContext: RequestContext,
  result: IssuedInvitation,
): InvitationAuditContext => ({
  event: {
    ...requestContext,
    category: "authorization",
    action: "scope_invitation_issue",
    outcome: "success",
    actorId: result.invitation.issuedBy,
    scopeId: result.invitation.scopeId,
    resourceType: "scope_invitation",
    resourceId: result.invitation.id,
    reason: result.reason,
    affectedCount: 1,
  },
  invitationId: result.invitation.id,
  intendedRole: result.invitation.intendedRole,
  expiresAt: result.invitation.expiresAt,
  inviteeIdentifier: result.invitation.inviteeIdentifier,
});

export const createInvitationRevokedAuditContext = (
  requestContext: RequestContext,
  result: RevokedInvitation,
): InvitationAuditContext => ({
  event: {
    ...requestContext,
    category: "authorization",
    action: "scope_invitation_revoke",
    outcome: "success",
    actorId: result.actorId,
    scopeId: result.invitation.scopeId,
    resourceType: "scope_invitation",
    resourceId: result.invitation.id,
    reason: result.reason,
    affectedCount: 1,
  },
  invitationId: result.invitation.id,
  intendedRole: result.invitation.intendedRole,
  expiresAt: result.invitation.expiresAt,
  inviteeIdentifier: result.invitation.inviteeIdentifier,
});
