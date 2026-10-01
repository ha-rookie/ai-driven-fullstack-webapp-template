import type { UserLifecycleTransitionResult } from "../auth";
import type { AuditEvent, RequestContext } from "./types";

export interface UserLifecycleAuditInput {
  readonly requestContext: RequestContext;
  readonly result: UserLifecycleTransitionResult;
}

export const createUserLifecycleAuditEvent = ({
  requestContext,
  result,
}: UserLifecycleAuditInput): AuditEvent => ({
  ...requestContext,
  category: "authentication",
  action: result.nextStatus === "disabled" ? "user_disable" : "user_reactivate",
  outcome: "success",
  actorId: result.actorId,
  resourceType: "user",
  resourceId: result.userId,
  reason: result.reason,
  affectedCount: result.revokedSessionCount,
});
