export interface ScopeMembership {
  scopeId: string;
  userId: string;
  role: string;
}

export type AuthorizationDenyReason =
  | "membership_required"
  | "membership_scope_mismatch"
  | "resource_scope_mismatch"
  | "action_not_configured"
  | "role_required";

export type AuthorizationDecision =
  | { allowed: true; role: string }
  | { allowed: false; reason: AuthorizationDenyReason };

export type RolePolicy = Readonly<Record<string, readonly string[]>>;

export interface ScopedAuthorizationRequest {
  action: string;
  requestedScopeId: string;
  resourceScopeId: string;
  membership: ScopeMembership | null;
}
