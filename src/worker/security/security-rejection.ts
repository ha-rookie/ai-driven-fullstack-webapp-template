import type { LogContext } from "../../shared/logging";
import type { AuditEvent } from "../audit";
import type { AuthenticationGuardFailure, ScopedAuthorizationGuardFailure } from "../authorization/http-guard";
import type { PrivilegedMembershipSafetyError } from "../administration/privileged-membership-safety";
import type { CsrfGuardFailure } from "../http/csrf";
import type { CorsRejectReason } from "../http/origin-cors";
import type { RateLimitCheckInput, RateLimitRejectDecision } from "../http/rate-limit";
import type { CredentialAttackDecision } from "./credential-attack";

export type SecurityRejectionEventType =
  | "authentication_rejected"
  | "authorization_rejected"
  | "administration_rejected"
  | "rate_limit_rejected"
  | "credential_attack_rejected"
  | "csrf_rejected"
  | "origin_rejected"
  | "webhook_rejected";

export type SecurityRejectionReasonCode =
  | "session_missing_or_invalid"
  | "authorization_denied"
  | "self_privileged_membership_change_denied"
  | "last_privileged_membership"
  | "rate_limited"
  | "credential_attempt_throttled"
  | "csrf_proof_missing_or_invalid"
  | "invalid_origin"
  | "origin_not_allowed"
  | "method_not_allowed"
  | "header_not_allowed"
  | "webhook_signature_invalid"
  | "webhook_replay_rejected"
  | "webhook_provider_mismatch"
  | "webhook_verification_failed";

export interface SecurityRejectionEvent {
  readonly eventType: SecurityRejectionEventType;
  readonly reasonCode: SecurityRejectionReasonCode;
  readonly outcome: "rejected";
  readonly timestamp: string;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly scopeId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
}

export interface SecurityRejectionContext {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly timestamp?: Date;
  readonly actorId?: string;
  readonly sessionId?: string;
  readonly scopeId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
}

const createEvent = (
  context: SecurityRejectionContext,
  eventType: SecurityRejectionEventType,
  reasonCode: SecurityRejectionReasonCode,
): SecurityRejectionEvent => ({
  eventType,
  reasonCode,
  outcome: "rejected",
  timestamp: (context.timestamp ?? new Date()).toISOString(),
  requestId: context.requestId,
  method: context.method,
  path: context.path,
  ...(context.actorId ? { actorId: context.actorId } : {}),
  ...(context.sessionId ? { sessionId: context.sessionId } : {}),
  ...(context.scopeId ? { scopeId: context.scopeId } : {}),
  ...(context.resourceType ? { resourceType: context.resourceType } : {}),
  ...(context.resourceId ? { resourceId: context.resourceId } : {}),
});

export const fromAuthenticationFailure = (
  _failure: AuthenticationGuardFailure,
  context: SecurityRejectionContext,
): SecurityRejectionEvent =>
  createEvent(context, "authentication_rejected", "session_missing_or_invalid");

export const fromAuthorizationFailure = (
  _failure: ScopedAuthorizationGuardFailure,
  context: SecurityRejectionContext,
): SecurityRejectionEvent =>
  createEvent(context, "authorization_rejected", "authorization_denied");

export const fromPrivilegedMembershipSafetyFailure = (
  failure: PrivilegedMembershipSafetyError,
  context: SecurityRejectionContext,
): SecurityRejectionEvent => {
  if (failure.reasonCode === "privileged_role_policy_invalid") {
    return createEvent(context, "administration_rejected", "authorization_denied");
  }
  return createEvent(context, "administration_rejected", failure.reasonCode);
};

export const fromCsrfFailure = (
  _failure: CsrfGuardFailure,
  context: SecurityRejectionContext,
): SecurityRejectionEvent =>
  createEvent(context, "csrf_rejected", "csrf_proof_missing_or_invalid");

export const fromOriginRejection = (
  reason: CorsRejectReason,
  context: SecurityRejectionContext,
): SecurityRejectionEvent => createEvent(context, "origin_rejected", reason);

export const fromRateLimitRejection = (
  _decision: RateLimitRejectDecision,
  input: RateLimitCheckInput,
  context: SecurityRejectionContext,
): SecurityRejectionEvent =>
  createEvent(
    {
      ...context,
      ...(input.subject.kind === "actor" ? { actorId: input.subject.id } : {}),
      resourceType: context.resourceType ?? "http_endpoint",
      resourceId: context.resourceId ?? input.policy.endpointId,
    },
    "rate_limit_rejected",
    "rate_limited",
  );

/**
 * Credential throttling never includes the submitted identifier, IP/network
 * subject, or their hashes. Those values are security-control inputs, not log data.
 */
export const fromCredentialAttackRejection = (
  _decision: Extract<CredentialAttackDecision, { kind: "reject" }>,
  endpointId: string,
  context: SecurityRejectionContext,
): SecurityRejectionEvent =>
  createEvent(
    {
      ...context,
      resourceType: context.resourceType ?? "credential_endpoint",
      resourceId: context.resourceId ?? endpointId,
    },
    "credential_attack_rejected",
    "credential_attempt_throttled",
  );

export const fromWebhookVerificationRejection = (
  verificationCode: string,
  context: SecurityRejectionContext,
): SecurityRejectionEvent => {
  const reasonCode: SecurityRejectionReasonCode = verificationCode === "invalid_signature"
    ? "webhook_signature_invalid"
    : verificationCode === "replay_rejected"
      ? "webhook_replay_rejected"
      : verificationCode === "provider_mismatch"
        ? "webhook_provider_mismatch"
        : "webhook_verification_failed";
  return createEvent(
    {
      ...context,
      resourceType: context.resourceType ?? "webhook_endpoint",
    },
    "webhook_rejected",
    reasonCode,
  );
};

export const securityRejectionAuditEvent = (
  event: SecurityRejectionEvent,
): AuditEvent => ({
  requestId: event.requestId,
  method: event.method,
  path: event.path,
  category:
    event.eventType === "authentication_rejected" || event.eventType === "credential_attack_rejected"
      ? "authentication"
      : event.eventType === "authorization_rejected" || event.eventType === "administration_rejected"
        ? "authorization"
        : "system",
  action: event.eventType,
  outcome: "failure",
  ...(event.actorId ? { actorId: event.actorId } : {}),
  ...(event.scopeId ? { scopeId: event.scopeId } : {}),
  ...(event.resourceType ? { resourceType: event.resourceType } : {}),
  ...(event.resourceId ? { resourceId: event.resourceId } : {}),
  reason: event.reasonCode,
});

export const securityRejectionLogContext = (
  event: SecurityRejectionEvent,
): LogContext => ({
  kind: "security_rejection",
  eventType: event.eventType,
  reasonCode: event.reasonCode,
  outcome: event.outcome,
  timestamp: event.timestamp,
  requestId: event.requestId,
  method: event.method,
  path: event.path,
  ...(event.actorId ? { actorId: event.actorId } : {}),
  ...(event.sessionId ? { sessionId: event.sessionId } : {}),
  ...(event.scopeId ? { scopeId: event.scopeId } : {}),
  ...(event.resourceType ? { resourceType: event.resourceType } : {}),
  ...(event.resourceId ? { resourceId: event.resourceId } : {}),
});
