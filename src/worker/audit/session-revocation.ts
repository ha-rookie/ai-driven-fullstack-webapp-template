import type { SessionRevocationResult } from "../auth";
import type { AuditEvent, RequestContext } from "./types";

export interface SessionRevocationAuditInput {
  readonly requestContext: RequestContext;
  readonly actorId: string;
  readonly result: SessionRevocationResult;
}

export const createSessionRevocationAuditEvent = ({
  requestContext,
  actorId,
  result,
}: SessionRevocationAuditInput): AuditEvent => ({
  ...requestContext,
  category: "authentication",
  action: result.mode === "all" ? "session_revoke_all" : "session_revoke_others",
  outcome: "success",
  actorId,
  resourceType: "application_session",
  resourceId: result.userId,
  affectedCount: result.revokedCount,
});
