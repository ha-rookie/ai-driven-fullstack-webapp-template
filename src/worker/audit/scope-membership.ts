import type { MembershipMutationResult } from "../administration";
import type { AuditEvent, RequestContext } from "./types";

export interface ScopeMembershipAuditInput {
  readonly requestContext: RequestContext;
  readonly result: MembershipMutationResult;
}

export const createScopeMembershipAuditEvent = ({
  requestContext,
  result,
}: ScopeMembershipAuditInput): AuditEvent => ({
  ...requestContext,
  category: "authorization",
  action:
    result.kind === "removed"
      ? "scope_membership_remove"
      : "scope_membership_add",
  outcome: "success",
  actorId: result.actorId,
  scopeId: result.scopeId,
  resourceType: "user",
  resourceId: result.targetUserId,
  reason: result.reason,
  affectedCount: result.kind === "already_exists" ? 0 : 1,
});
