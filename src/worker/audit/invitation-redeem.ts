import type { RedeemedInvitation } from "../administration";
import type { AuditEvent, RequestContext } from "./types";

export interface InvitationRedeemAuditInput {
  readonly requestContext: RequestContext;
  readonly result: RedeemedInvitation;
}

export interface InvitationRedeemAuditContext {
  readonly event: AuditEvent;
  readonly invitationId: string;
  readonly role: string;
  readonly membershipKind: "added" | "already_exists";
}

export const createInvitationRedeemAuditContext = ({
  requestContext,
  result,
}: InvitationRedeemAuditInput): InvitationRedeemAuditContext => ({
  event: {
    ...requestContext,
    category: "authorization",
    action: "scope_invitation_redeem",
    outcome: "success",
    actorId: result.userId,
    scopeId: result.scopeId,
    resourceType: "scope_invitation",
    resourceId: result.invitationId,
    reason: result.reason,
    affectedCount: result.membershipKind === "added" ? 1 : 0,
  },
  invitationId: result.invitationId,
  role: result.role,
  membershipKind: result.membershipKind,
});
