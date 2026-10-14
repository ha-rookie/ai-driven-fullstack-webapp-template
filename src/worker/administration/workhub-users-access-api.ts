import { queryActiveApplicationSessionsForUser } from "../auth";
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

interface Env { readonly DB: D1Database }
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
  request: Request, env: Env, requestId: string,
): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  const members = /^\/api\/admin\/scopes\/([^/]+)\/memberships$/u.exec(path);
  const sessions = /^\/api\/admin\/scopes\/([^/]+)\/users\/([^/]+)\/sessions$/u.exec(path);
  if (!members && !sessions) return null;
  if (request.method !== "GET") return error(requestId, 405, "method_not_allowed");
  if ((members ?? sessions)![1] !== SCOPE_ID) return error(requestId, 403, "forbidden");
  const targetUserId = sessions?.[2];
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
