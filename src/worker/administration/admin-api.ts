import {
  queryActiveApplicationSessionsForUser,
  disableUser,
  reactivateUser,
  type SessionPolicy,
} from "../auth";
import {
  requireAuthenticatedUser,
  requireScopedAuthorization,
  type RolePolicy,
} from "../authorization";
import type { AuditEvent } from "../audit";
import {
  apiErrorResponse,
  csrfGuardFailureResponse,
  readJsonBody,
  requireCsrfProtection,
  rateLimitRejectionResponse,
  type RateLimitGuard,
  type RateLimitPolicy,
} from "../http";
import {
  fromAuthenticationFailure,
  fromAuthorizationFailure,
  fromCsrfFailure,
  fromPrivilegedMembershipSafetyFailure,
  fromRateLimitRejection,
  type SecurityRejectionEvent,
} from "../security";
import {
  addScopeMembership,
  MembershipMutationError,
} from "./membership-management";
import {
  MembershipRoleChangeError,
  type MembershipRolePolicy,
} from "./membership-role-change";
import {
  changeMembershipRoleSafely,
  PrivilegedMembershipSafetyError,
  removeScopeMembershipSafely,
  type PrivilegedMembershipPolicy,
} from "./privileged-membership-safety";
import {
  InvitationError,
  issueInvitation,
  revokeInvitation,
  type InvitationRolePolicy,
} from "./invitation";

type RequestAuditFields = Omit<AuditEvent, "requestId" | "method" | "path">;
type Audit = (event: RequestAuditFields) => void;
type SecurityEventSink = (event: SecurityRejectionEvent) => void;

export interface UserLifecycleScopePolicy {
  canManageUser(
    scopeId: string,
    targetUserId: string,
  ): boolean | Promise<boolean>;
}

export interface AdministrationApiOptions {
  readonly authorizationPolicy: RolePolicy;
  readonly membershipRolePolicy: MembershipRolePolicy;
  readonly privilegedMembershipPolicy: PrivilegedMembershipPolicy;
  readonly invitationRolePolicy: InvitationRolePolicy;
  readonly userLifecycleScopePolicy: UserLifecycleScopePolicy;
  readonly rateLimitGuard: RateLimitGuard;
  readonly rateLimitPolicy: RateLimitPolicy;
  readonly sessionPolicy?: SessionPolicy;
  readonly securityEventSink?: SecurityEventSink;
}

const ADMIN_ACTION = "administration:manage";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const error = (
  requestId: string,
  code: string,
  message: string,
  status: number,
): Response => apiErrorResponse({ code, message, status }, requestId);

const emitSecurity = (
  sink: SecurityEventSink | undefined,
  event: SecurityRejectionEvent,
): void => {
  try {
    sink?.(event);
  } catch {
    // Security telemetry failure must never convert reject into allow.
  }
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const requiredString = (
  body: Record<string, unknown> | null,
  key: string,
  maxLength: number,
): string | null => {
  const value = body?.[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
};

const decodePart = (value: string): string | null => {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded ? decoded : null;
  } catch {
    return null;
  }
};

interface Route {
  readonly scopeId: string;
  readonly kind:
    | "membership-create"
    | "membership-remove"
    | "membership-role"
    | "invitation-issue"
    | "invitation-revoke"
    | "user-disable"
    | "user-reactivate"
    | "active-sessions";
  readonly targetId?: string;
}

const resolveRoute = (pathname: string): Route | null => {
  const base = pathname.match(/^\/api\/admin\/scopes\/([^/]+)\/(.+)$/);
  if (!base) return null;
  const scopeId = decodePart(base[1]);
  if (!scopeId) return null;
  const rest = base[2];

  if (rest === "memberships") return { scopeId, kind: "membership-create" };
  if (rest === "invitations") return { scopeId, kind: "invitation-issue" };

  const membershipRole = rest.match(/^memberships\/([^/]+)\/role$/);
  if (membershipRole) {
    const targetId = decodePart(membershipRole[1]);
    return targetId ? { scopeId, kind: "membership-role", targetId } : null;
  }
  const membership = rest.match(/^memberships\/([^/]+)$/);
  if (membership) {
    const targetId = decodePart(membership[1]);
    return targetId ? { scopeId, kind: "membership-remove", targetId } : null;
  }
  const invitation = rest.match(/^invitations\/([^/]+)\/revoke$/);
  if (invitation) {
    const targetId = decodePart(invitation[1]);
    return targetId ? { scopeId, kind: "invitation-revoke", targetId } : null;
  }
  const user = rest.match(/^users\/([^/]+)\/(disable|reactivate|sessions)$/);
  if (user) {
    const targetId = decodePart(user[1]);
    if (!targetId) return null;
    return {
      scopeId,
      targetId,
      kind:
        user[2] === "disable"
          ? "user-disable"
          : user[2] === "reactivate"
            ? "user-reactivate"
            : "active-sessions",
    };
  }
  return null;
};

const expectedMethod = (kind: Route["kind"]): string => {
  switch (kind) {
    case "membership-create":
    case "invitation-issue":
    case "invitation-revoke":
    case "user-disable":
    case "user-reactivate":
      return "POST";
    case "membership-remove":
      return "DELETE";
    case "membership-role":
      return "PATCH";
    case "active-sessions":
      return "GET";
  }
};

export const handleAdministrationApi = async (
  request: Request,
  db: D1Database,
  audit: Audit,
  requestId: string,
  options: AdministrationApiOptions,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const route = resolveRoute(url.pathname);
  if (!route) return null;

  if (request.method !== expectedMethod(route.kind)) {
    return error(requestId, "method_not_allowed", "Method not allowed", 405);
  }

  const securityContext = {
    requestId,
    method: request.method,
    path: url.pathname,
    scopeId: route.scopeId,
    ...(route.targetId ? { resourceId: route.targetId } : {}),
    resourceType: "administration",
  } as const;

  let authentication;
  try {
    authentication = await requireAuthenticatedUser(
      request,
      db,
      options.sessionPolicy,
    );
  } catch {
    return error(
      requestId,
      "authentication_unavailable",
      "Authentication is unavailable",
      503,
    );
  }
  if (!authentication.allowed) {
    emitSecurity(
      options.securityEventSink,
      fromAuthenticationFailure(authentication, securityContext),
    );
    return error(requestId, authentication.code, authentication.message, authentication.status);
  }

  const actorId = authentication.user.id;
  const rateInput = {
    policy: options.rateLimitPolicy,
    subject: { kind: "actor" as const, id: actorId },
  };
  try {
    const rate = await options.rateLimitGuard.check(rateInput);
    if (rate.kind === "reject") {
      emitSecurity(
        options.securityEventSink,
        fromRateLimitRejection(rate, rateInput, { ...securityContext, actorId }),
      );
      return rateLimitRejectionResponse(rate, requestId);
    }
  } catch {
    return error(requestId, "rate_limit_unavailable", "Request guard is unavailable", 503);
  }

  let authorization;
  try {
    authorization = await requireScopedAuthorization({
      db,
      userId: actorId,
      policy: options.authorizationPolicy,
      action: ADMIN_ACTION,
      requestedScopeId: route.scopeId,
      resourceScopeId: route.scopeId,
    });
  } catch {
    return error(requestId, "authorization_unavailable", "Authorization is unavailable", 503);
  }
  if (!authorization.allowed) {
    emitSecurity(
      options.securityEventSink,
      fromAuthorizationFailure(authorization, { ...securityContext, actorId }),
    );
    return error(requestId, authorization.code, authorization.message, authorization.status);
  }

  if (request.method !== "GET") {
    const csrf = await requireCsrfProtection(request);
    if (!csrf.allowed) {
      emitSecurity(
        options.securityEventSink,
        fromCsrfFailure(csrf, { ...securityContext, actorId }),
      );
      return csrfGuardFailureResponse(csrf, requestId);
    }
  }

  if (route.kind === "active-sessions") {
    try {
      if (!(await options.userLifecycleScopePolicy.canManageUser(route.scopeId, route.targetId!))) {
        return error(requestId, "forbidden", "Access denied", 403);
      }
      const sessions = await queryActiveApplicationSessionsForUser(
        db,
        route.targetId!,
        { sessionPolicy: options.sessionPolicy },
      );
      return json({ sessions });
    } catch {
      return error(requestId, "administration_unavailable", "Administration is unavailable", 503);
    }
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    return apiErrorResponse(
      {
        status: bodyResult.status,
        code: bodyResult.code,
        message: bodyResult.message,
      },
      requestId,
    );
  }
  const body = asObject(bodyResult.value);
  const reason = requiredString(body, "reason", 200);
  if (!reason) {
    return error(requestId, "invalid_request", "reason is required", 400);
  }

  try {
    switch (route.kind) {
      case "membership-create": {
        const userId = requiredString(body, "userId", 128);
        const role = requiredString(body, "role", 64);
        if (!userId || !role) {
          return error(requestId, "invalid_request", "userId and role are required", 400);
        }
        const result = await addScopeMembership(db, {
          actorId,
          userId,
          scopeId: route.scopeId,
          role,
          reason,
        });
        audit({ category: "authorization", action: "admin.membership.add", outcome: "success", actorId, scopeId: route.scopeId, resourceType: "user", resourceId: userId, reason });
        return json({ result }, result.kind === "added" ? 201 : 200);
      }
      case "membership-remove": {
        const result = await removeScopeMembershipSafely(
          db,
          options.privilegedMembershipPolicy,
          { actorId, userId: route.targetId!, scopeId: route.scopeId, reason },
        );
        audit({ category: "authorization", action: "admin.membership.remove", outcome: "success", actorId, scopeId: route.scopeId, resourceType: "user", resourceId: route.targetId!, reason });
        return json({ result });
      }
      case "membership-role": {
        const nextRole = requiredString(body, "nextRole", 64);
        if (!nextRole) {
          return error(requestId, "invalid_request", "nextRole is required", 400);
        }
        const result = await changeMembershipRoleSafely(
          db,
          options.membershipRolePolicy,
          options.privilegedMembershipPolicy,
          { actorId, userId: route.targetId!, scopeId: route.scopeId, nextRole, reason },
        );
        audit({ category: "authorization", action: "admin.membership.role_change", outcome: "success", actorId, scopeId: route.scopeId, resourceType: "user", resourceId: route.targetId!, reason });
        return json({ result });
      }
      case "invitation-issue": {
        const intendedRole = requiredString(body, "intendedRole", 64);
        if (!intendedRole) {
          return error(requestId, "invalid_request", "intendedRole is required", 400);
        }
        const inviteeIdentifier =
          typeof body?.inviteeIdentifier === "string"
            ? body.inviteeIdentifier.trim() || null
            : null;
        const result = await issueInvitation(
          db,
          { actorId, scopeId: route.scopeId, intendedRole, inviteeIdentifier, reason },
          options.invitationRolePolicy,
        );
        audit({ category: "authorization", action: "admin.invitation.issue", outcome: "success", actorId, scopeId: route.scopeId, resourceType: "invitation", resourceId: result.invitation.id, reason });
        return json({ invitation: result.invitation, redeemToken: result.redeemToken }, 201);
      }
      case "invitation-revoke": {
        const current = await import("./invitation").then(({ findInvitationById }) =>
          findInvitationById(db, route.targetId!),
        );
        if (!current || current.scopeId !== route.scopeId) {
          return error(requestId, "invitation_not_found", "Invitation not found", 404);
        }
        const result = await revokeInvitation(db, {
          actorId,
          invitationId: route.targetId!,
          reason,
        });
        audit({ category: "authorization", action: "admin.invitation.revoke", outcome: "success", actorId, scopeId: route.scopeId, resourceType: "invitation", resourceId: route.targetId!, reason });
        return json({ invitation: result.invitation });
      }
      case "user-disable":
      case "user-reactivate": {
        if (!(await options.userLifecycleScopePolicy.canManageUser(route.scopeId, route.targetId!))) {
          return error(requestId, "forbidden", "Access denied", 403);
        }
        const result =
          route.kind === "user-disable"
            ? await disableUser(db, route.targetId!, { actorId, reason })
            : await reactivateUser(db, route.targetId!, { actorId, reason });
        audit({ category: "authorization", action: route.kind === "user-disable" ? "admin.user.disable" : "admin.user.reactivate", outcome: "success", actorId, scopeId: route.scopeId, resourceType: "user", resourceId: route.targetId!, reason });
        return json({ result });
      }
      case "active-sessions":
        return error(requestId, "method_not_allowed", "Method not allowed", 405);
    }
  } catch (caught) {
    if (caught instanceof PrivilegedMembershipSafetyError) {
      emitSecurity(
        options.securityEventSink,
        fromPrivilegedMembershipSafetyFailure(caught, {
          ...securityContext,
          actorId,
        }),
      );
      return error(requestId, caught.reasonCode, "Administrative operation rejected", 409);
    }
    if (
      caught instanceof MembershipMutationError ||
      caught instanceof MembershipRoleChangeError ||
      caught instanceof InvitationError
    ) {
      return error(requestId, caught.reasonCode, "Administrative operation rejected", 409);
    }
    if (caught instanceof TypeError) {
      return error(requestId, "invalid_request", "Request is invalid", 400);
    }
    return error(requestId, "administration_unavailable", "Administration is unavailable", 503);
  }
};
