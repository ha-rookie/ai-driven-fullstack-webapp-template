import type {
  AuthorizationDecision,
  RolePolicy,
  ScopedAuthorizationRequest,
} from "./types";

export const authorizeScopedAction = (
  policy: RolePolicy,
  request: ScopedAuthorizationRequest,
): AuthorizationDecision => {
  const { action, requestedScopeId, resourceScopeId, membership } = request;

  if (!membership) {
    return { allowed: false, reason: "membership_required" };
  }

  if (membership.scopeId !== requestedScopeId) {
    return { allowed: false, reason: "membership_scope_mismatch" };
  }

  if (resourceScopeId !== requestedScopeId) {
    return { allowed: false, reason: "resource_scope_mismatch" };
  }

  const allowedRoles = policy[action];
  if (!allowedRoles) {
    return { allowed: false, reason: "action_not_configured" };
  }

  if (!allowedRoles.includes(membership.role)) {
    return { allowed: false, reason: "role_required" };
  }

  return { allowed: true, role: membership.role };
};
