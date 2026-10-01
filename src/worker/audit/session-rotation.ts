import type { SessionRotationFailureReason } from "../auth";
import type { AuditEvent, RequestContext } from "./types";

export interface SessionRotationAuditInput {
  readonly requestContext: RequestContext;
  readonly outcome: "success" | "failure";
  readonly userId?: string | null;
  readonly reason?: SessionRotationFailureReason | "dependency_error";
}

export const createSessionRotationAuditEvent = ({
  requestContext,
  outcome,
  userId,
  reason,
}: SessionRotationAuditInput): AuditEvent => ({
  ...requestContext,
  category: "authentication",
  action: "session_rotate",
  outcome,
  actorId: userId,
  resourceType: "application_session",
  resourceId: userId,
  ...(reason ? { reason } : {}),
});
