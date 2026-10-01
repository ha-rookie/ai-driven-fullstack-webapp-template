import type {
  PrivilegedMembershipSafetyError,
} from "../administration/privileged-membership-safety";
import type { AuditEvent, RequestContext } from "./types";

export interface PrivilegedMembershipSafetyAuditInput {
  readonly requestContext: RequestContext;
  readonly actorId: string;
  readonly targetUserId: string;
  readonly scopeId: string;
  readonly error: PrivilegedMembershipSafetyError;
}

export const createPrivilegedMembershipSafetyAuditEvent = ({
  requestContext,
  actorId,
  targetUserId,
  scopeId,
  error,
}: PrivilegedMembershipSafetyAuditInput): AuditEvent => ({
  ...requestContext,
  category: "authorization",
  action: "privileged_membership_change_rejected",
  outcome: "failure",
  actorId,
  scopeId,
  resourceType: "user",
  resourceId: targetUserId,
  reason: error.reasonCode,
  affectedCount: 0,
});
