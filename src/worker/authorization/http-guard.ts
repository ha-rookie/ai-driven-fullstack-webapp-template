import {
  resolveApplicationSession,
  type AuthenticatedUser,
} from "../auth";
import { findScopeMembership } from "./membership";
import { authorizeScopedAction } from "./policy";
import type {
  AuthorizationDenyReason,
  RolePolicy,
  ScopeMembership,
} from "./types";

export interface AuthenticationGuardFailure {
  allowed: false;
  status: 401;
  code: "authentication_required";
  message: "Authentication required";
  reason: "session_missing_or_invalid";
}

export type AuthenticationGuardResult =
  | { allowed: true; user: AuthenticatedUser }
  | AuthenticationGuardFailure;

export interface ScopedAuthorizationGuardFailure {
  allowed: false;
  status: 403;
  code: "forbidden";
  message: "Access denied";
  reason: AuthorizationDenyReason;
}

export type ScopedAuthorizationGuardResult =
  | {
      allowed: true;
      membership: ScopeMembership;
      role: string;
    }
  | ScopedAuthorizationGuardFailure;

export type AuthorizationHttpGuardFailure =
  | AuthenticationGuardFailure
  | ScopedAuthorizationGuardFailure;

export const requireAuthenticatedUser = async (
  request: Request,
  db: D1Database,
): Promise<AuthenticationGuardResult> => {
  const session = await resolveApplicationSession(request, db);

  return session
    ? { allowed: true, user: session.user }
    : {
        allowed: false,
        status: 401,
        code: "authentication_required",
        message: "Authentication required",
        reason: "session_missing_or_invalid",
      };
};

export interface RequireScopedAuthorizationInput {
  db: D1Database;
  userId: string;
  policy: RolePolicy;
  action: string;
  requestedScopeId: string;
  resourceScopeId: string;
}

export const requireScopedAuthorization = async ({
  db,
  userId,
  policy,
  action,
  requestedScopeId,
  resourceScopeId,
}: RequireScopedAuthorizationInput): Promise<ScopedAuthorizationGuardResult> => {
  const membership = await findScopeMembership(db, userId, requestedScopeId);
  const decision = authorizeScopedAction(policy, {
    action,
    requestedScopeId,
    resourceScopeId,
    membership,
  });

  return decision.allowed
    ? { allowed: true, membership: membership!, role: decision.role }
    : {
        allowed: false,
        status: 403,
        code: "forbidden",
        message: "Access denied",
        reason: decision.reason,
      };
};

export const authorizationGuardFailureResponse = (
  failure: AuthorizationHttpGuardFailure,
): Response =>
  new Response(
    JSON.stringify({
      error: {
        code: failure.code,
        message: failure.message,
      },
    }),
    {
      status: failure.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
