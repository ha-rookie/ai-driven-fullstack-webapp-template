import { requireAuthenticatedUser, requireScopedAuthorization } from "../authorization";
import { D1OperationModeStore } from "../../infrastructure/d1-operation-mode-store";
import { apiErrorResponse, csrfGuardFailureResponse, readJsonBody, requireCsrfProtection,
  OperationModeGuard, operationModeRejectionResponse } from "../http";
import { resolveWorkhubRuntimeEnvironment } from "../workhub-login";
import { findInvitationById, InvitationError, issueInvitation, revokeInvitation } from "./invitation";
import type { AuditEvent } from "../audit";

/** #99 reference adapter: bounded invitation administration for one fixed WORKHUB Scope only. */
const SCOPE_ID = "workhub-company";
const ACTION = "administration:manage";
const POLICY = { [ACTION]: ["system_admin"] };
const ROLES = ["newcomer", "employee", "manager", "accounting", "corporate"] as const;
const validRole = (role: unknown): role is (typeof ROLES)[number] =>
  typeof role === "string" && ROLES.some(allowed => allowed === role);
const MAX_INVITES = 50;
const VALID_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;

interface Env { readonly DB: D1Database; readonly RUNTIME_ENVIRONMENT?: string }
type Audit = (fields: Omit<AuditEvent, "requestId" | "method" | "path">) => void;
interface InvitationRow {
  readonly id: string;
  readonly scopeId: string;
  readonly inviteeIdentifier: string | null;
  readonly intendedRole: string;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly redeemedAt: string | null;
  readonly revokedAt: string | null;
}
const respond = (value: unknown, status = 200): Response => Response.json(value, {
  status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
});
const reject = (rid: string, status: number, code: string): Response =>
  apiErrorResponse({ status, code, message: status === 403 ? "Access denied" :
    status === 401 ? "Authentication required" :
      status === 409 ? "Invitation state changed; refresh" : "Invitation administration is unavailable" }, rid);

const state = (row: InvitationRow, now: string) =>
  row.revokedAt !== null ? "revoked" :
    row.redeemedAt !== null ? "redeemed" :
      row.expiresAt <= now ? "expired" : "open";

export const handleWorkhubInvitationApi = async (
  request: Request, env: Env, requestId: string, audit: Audit,
): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  const list = /^\/api\/admin\/scopes\/([^/]+)\/invitations$/u.exec(path);
  const revoke = /^\/api\/admin\/scopes\/([^/]+)\/invitations\/([^/]+)\/revoke$/u.exec(path);
  if (!list && !revoke) return null;
  const supported = list ? request.method === "GET" || request.method === "POST" : request.method === "POST";
  if (!supported) return reject(requestId, 405, "method_not_allowed");
  if ((list ?? revoke)![1] !== SCOPE_ID) return reject(requestId, 403, "forbidden");
  if (revoke && !VALID_ID.test(revoke[2])) {
    return apiErrorResponse({ status: 400, code: "invalid_request", message: "Invalid invitation" }, requestId);
  }

  let actorId: string;
  try {
    const auth = await requireAuthenticatedUser(request, env.DB);
    if (!auth.allowed) return reject(requestId, 401, "authentication_required");
    actorId = auth.user.id;
  } catch {
    return reject(requestId, 503, "authentication_unavailable");
  }
  try {
    const authz = await requireScopedAuthorization({
      db: env.DB, userId: actorId, policy: POLICY, action: ACTION,
      requestedScopeId: SCOPE_ID, resourceScopeId: SCOPE_ID,
    });
    if (!authz.allowed) return reject(requestId, 403, "forbidden");
  } catch {
    return reject(requestId, 503, "authorization_unavailable");
  }

  if (request.method === "GET") {
    try {
      const result = await env.DB.prepare(
        "SELECT id,scope_id AS scopeId,invitee_identifier AS inviteeIdentifier,intended_role AS intendedRole,issued_by AS issuedBy,issued_at AS issuedAt,expires_at AS expiresAt,redeemed_at AS redeemedAt,revoked_at AS revokedAt FROM scope_invitations WHERE scope_id=? ORDER BY issued_at DESC,id DESC LIMIT ?",
      ).bind(SCOPE_ID, MAX_INVITES + 1).all<InvitationRow>();
      const now = new Date().toISOString();
      const invitations = result.results.slice(0, MAX_INVITES).map(row =>
        ({ ...row, state: state(row, now) }));
      // Token and token hash are deliberately excluded from the SQL projection.
      return respond({ scopeId: SCOPE_ID, invitations, limit: MAX_INVITES,
        hasMore: result.results.length > MAX_INVITES });
    } catch {
      return reject(requestId, 503, "administration_unavailable");
    }
  }

  try {
    const runtime = resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
    const mode = await new OperationModeGuard(
      new D1OperationModeStore(env.DB, runtime), { environment: runtime, retryAfterSeconds: 30 },
    ).check(request);
    if (!mode.allowed) return operationModeRejectionResponse(mode, requestId);
  } catch {
    return reject(requestId, 503, "operation_mode_unavailable");
  }
  const csrf = await requireCsrfProtection(request);
  if (!csrf.allowed) return csrfGuardFailureResponse(csrf, requestId);
  const parsed = await readJsonBody(request, { maxBytes: 1024 });
  if (!parsed.ok) {
    return apiErrorResponse({ status: parsed.status, code: parsed.code, message: parsed.message }, requestId);
  }
  const obj = typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown> : null;
  const reason = typeof obj?.reason === "string" ? obj.reason.trim() : "";
  if (!obj || !reason || reason.length > 200 || obj.confirmed !== true) {
    return apiErrorResponse({ status: 400, code: "invalid_request", message: "Reason and explicit confirmation required" }, requestId);
  }

  try {
    if (list) {
      if (!validRole(obj.intendedRole)) {
        return apiErrorResponse({ status: 400, code: "invalid_role", message: "Allowed nonprivileged role required" }, requestId);
      }
      if (obj.inviteeIdentifier !== undefined && obj.inviteeIdentifier !== null &&
        (typeof obj.inviteeIdentifier !== "string" || obj.inviteeIdentifier.length > 320)) {
        return apiErrorResponse({ status: 400, code: "invalid_request", message: "Invalid invitee" }, requestId);
      }
      const issued = await issueInvitation(env.DB, {
        actorId, scopeId: SCOPE_ID, intendedRole: obj.intendedRole,
        inviteeIdentifier: typeof obj.inviteeIdentifier === "string" ? obj.inviteeIdentifier.trim() || null : null,
        reason,
      }, { isAllowed: role => validRole(role) });
      audit({ category: "authorization", action: "admin.invitation.issue", outcome: "success",
        actorId, scopeId: SCOPE_ID, resourceType: "invitation", resourceId: issued.invitation.id, reason });
      // Raw token is returned ONLY from this one issuance, never from GET, DB or audit.
      return respond({ invitation: issued.invitation, redeemToken: issued.redeemToken }, 201);
    }

    const id = revoke![2];
    const existing = await findInvitationById(env.DB, id);
    if (!existing || existing.scopeId !== SCOPE_ID) return reject(requestId, 403, "forbidden");
    if (existing.state !== "open" || obj.expectedState !== "open") {
      return reject(requestId, 409, "invitation_conflict");
    }
    const revoked = await revokeInvitation(env.DB, { actorId, invitationId: id, reason });
    audit({ category: "authorization", action: "admin.invitation.revoke", outcome: "success",
      actorId, scopeId: SCOPE_ID, resourceType: "invitation", resourceId: id, reason });
    return respond({ invitation: revoked.invitation });
  } catch (caught) {
    if (caught instanceof InvitationError) return reject(requestId, 409, caught.reasonCode);
    if (caught instanceof TypeError) {
      return apiErrorResponse({ status: 400, code: "invalid_request", message: "Invalid invitation request" }, requestId);
    }
    return reject(requestId, 503, "administration_unavailable");
  }
};
