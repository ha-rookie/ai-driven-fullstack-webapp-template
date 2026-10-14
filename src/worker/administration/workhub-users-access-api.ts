import { disableUser, reactivateUser, queryActiveApplicationSessionsForUser, UserLifecycleTransitionError } from "../auth";
import { D1OperationModeStore } from "../../infrastructure/d1-operation-mode-store";
import { resolveWorkhubRuntimeEnvironment } from "../workhub-login";
import { OperationModeGuard, operationModeRejectionResponse, requireCsrfProtection, csrfGuardFailureResponse, readJsonBody } from "../http";
import type { AuditEvent } from "../audit";
import { requireAuthenticatedUser, requireScopedAuthorization } from "../authorization";
import { apiErrorResponse } from "../http";

/**
 * WORKHUB reference adapter for the existing #99 Users & Access read model.
 * Only two GET endpoints are exposed. Generic Administration mutations are
 * intentionally NOT mounted into the running WORKHUB Worker.
 */
const SCOPE_ID = "workhub-company";
const VIEW_ACTION = "administration:manage";
const POLICY = { [VIEW_ACTION]: ["system_admin"] };
const MAX_MEMBERS = 50;
const VALID_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;

interface Env { readonly DB: D1Database; readonly RUNTIME_ENVIRONMENT?: string }
type Audit = (event: Omit<AuditEvent, "requestId" | "method" | "path">) => void;
interface Member {
  readonly userId: string;
  readonly displayName: string | null;
  readonly status: "active" | "disabled";
  readonly role: string;
}

const respond = (value: unknown): Response => Response.json(value, {
  headers: { "cache-control": "no-store" },
});
const error = (rid: string, status: number, code: string): Response =>
  apiErrorResponse({ status, code, message: status === 403 ? "Access denied" : status === 401 ? "Authentication required" : status === 405 ? "Method not allowed" : "Administration is unavailable" }, rid);

export const handleWorkhubUsersAccessApi = async (
  request: Request, env: Env, requestId: string, audit: Audit,
): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  const members = /^\/api\/admin\/scopes\/([^/]+)\/memberships$/u.exec(path);
  const sessions = /^\/api\/admin\/scopes\/([^/]+)\/users\/([^/]+)\/sessions$/u.exec(path);
  const lifecycle = /^\/api\/admin\/scopes\/([^/]+)\/users\/([^/]+)\/(disable|reactivate)$/u.exec(path);
  if (!members && !sessions && !lifecycle) return null;
  if (request.method !== (lifecycle ? "POST" : "GET")) return error(requestId, 405, "method_not_allowed");
  if ((members ?? sessions ?? lifecycle)![1] !== SCOPE_ID) return error(requestId, 403, "forbidden");
  const targetUserId = (sessions ?? lifecycle)?.[2];
  if (targetUserId && !VALID_ID.test(targetUserId)) {
    return apiErrorResponse({ status: 400, code: "invalid_request", message: "Invalid target" }, requestId);
  }

  let actorId: string;
  try {
    const auth = await requireAuthenticatedUser(request, env.DB);
    if (!auth.allowed) return error(requestId, 401, "authentication_required");
    actorId = auth.user.id;
  } catch {
    return error(requestId, 503, "authentication_unavailable");
  }

  try {
    const authorization = await requireScopedAuthorization({
      db: env.DB,
      userId: actorId,
      policy: POLICY,
      action: VIEW_ACTION,
      requestedScopeId: SCOPE_ID,
      resourceScopeId: SCOPE_ID,
    });
    if (!authorization.allowed) return error(requestId, 403, "forbidden");
  } catch {
    return error(requestId, 503, "authorization_unavailable");
  }

  if (lifecycle && targetUserId) {
    try {
      // WORKHUB mutations obey the same local/preview/production operation mode as business mutations.
      const runtime = resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
      const mode = await new OperationModeGuard(
        new D1OperationModeStore(env.DB, runtime), { environment: runtime, retryAfterSeconds: 30 },
      ).check(request);
      if (!mode.allowed) return operationModeRejectionResponse(mode, requestId);
    } catch {
      return error(requestId, 503, "operation_mode_unavailable");
    }
    const csrf = await requireCsrfProtection(request);
    if (!csrf.allowed) return csrfGuardFailureResponse(csrf, requestId);
    const parsed = await readJsonBody(request, { maxBytes: 1024 });
    if (!parsed.ok) return apiErrorResponse({ status: parsed.status, code: parsed.code, message: parsed.message }, requestId);
    const body = parsed.value;
    const obj = typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown> : null;
    const reason = typeof obj?.reason === "string" ? obj.reason.trim() : "";
    const expected = lifecycle[3] === "disable" ? "active" : "disabled";
    if (!obj || !reason || reason.length > 200 || obj.confirmed !== true || obj.expectedStatus !== expected) {
      return apiErrorResponse({ status: 400, code: "invalid_request", message: "Reason, confirmation and expected status are required" }, requestId);
    }
    try {
      const target = await env.DB.prepare(
        "SELECT m.role AS role,u.status AS status FROM scope_memberships m JOIN users u ON u.id=m.user_id WHERE m.scope_id=? AND m.user_id=?",
      ).bind(SCOPE_ID, targetUserId).first<{ role: string; status: string }>();
      // Never let a reference UI lock out the current or another privileged administrator.
      if (!target || targetUserId === actorId || target.role === "system_admin") {
        return error(requestId, 403, "forbidden");
      }
      if (target.status !== expected) {
        return apiErrorResponse({ status: 409, code: "stale_user_status", message: "User state has changed; reload before retrying" }, requestId);
      }
      const result = lifecycle[3] === "disable"
        ? await disableUser(env.DB, targetUserId, { actorId, reason })
        : await reactivateUser(env.DB, targetUserId, { actorId, reason });
      audit({ category: "authorization", action: lifecycle[3] === "disable" ? "admin.user.disable" : "admin.user.reactivate",
        outcome: "success", actorId, scopeId: SCOPE_ID, resourceType: "user", resourceId: targetUserId, reason });
      return respond({ result });
    } catch (caught) {
      if (caught instanceof UserLifecycleTransitionError) {
        return apiErrorResponse({ status: 409, code: "user_state_conflict", message: "User state changed; reload before retrying" }, requestId);
      }
      return error(requestId, 503, "administration_unavailable");
    }
  }

  try {
    if (!targetUserId) {
      const query = await env.DB.prepare(
        "SELECT u.id AS userId,u.display_name AS displayName,u.status AS status,m.role AS role FROM scope_memberships m JOIN users u ON u.id=m.user_id WHERE m.scope_id=? ORDER BY u.id LIMIT ?",
      ).bind(SCOPE_ID, MAX_MEMBERS + 1).all<Member>();
      return respond({
        scopeId: SCOPE_ID,
        members: query.results.slice(0, MAX_MEMBERS),
        hasMore: query.results.length > MAX_MEMBERS,
        limit: MAX_MEMBERS,
      });
    }
    // The existing generic API's target guard is a project policy. For this
    // reference read route, reject any target outside the approved Scope.
    const allowedTarget = await env.DB.prepare(
      "SELECT 1 AS allowed FROM scope_memberships WHERE scope_id=? AND user_id=?",
    ).bind(SCOPE_ID, targetUserId).first<{ allowed: number }>();
    if (!allowedTarget) return error(requestId, 403, "forbidden");
    const found = await queryActiveApplicationSessionsForUser(env.DB, targetUserId);
    return respond({ sessions: found });
  } catch {
    return error(requestId, 503, "administration_unavailable");
  }
};
