import type { MembershipRoleChangeResult } from "../administration";
import type { AuditEvent, RequestContext } from "./types";

export interface MembershipRoleChangeAuditInput {
  readonly requestContext: RequestContext;
  readonly result: MembershipRoleChangeResult;
}

export const createMembershipRoleChangeAuditEvent = ({
  requestContext,
  result,
}: MembershipRoleChangeAuditInput): AuditEvent => ({
  ...requestContext,
  category: "authorization",
  action: "scope_membership_role_change",
  outcome: "success",
  actorId: result.actorId,
  scopeId: result.scopeId,
  resourceType: "user",
  resourceId: result.targetUserId,
  reason: result.reason,
  affectedCount: result.kind === "changed" ? 1 : 0,
  metadata: {
    previousRole: result.previousRole,
    nextRole: result.nextRole,
  },
});
