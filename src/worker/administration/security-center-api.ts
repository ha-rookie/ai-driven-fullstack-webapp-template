/**
 * #420 Stage8 Slice A: trusted, read-only security visibility for WORKHUB.
 * The live scanner/provider feed is intentionally NOT connected; do not
 * translate GitHub CI status or Audit Events into Security Findings.
 */
import { SECURITY_SOURCE_KINDS } from "../../shared/security/security-source-snapshot";
import { normalizeSecuritySourceCoverage } from "../../shared/security/security-finding";
import { requireAuthenticatedUser, requireScopedAuthorization } from "../authorization";
import { resolveWorkhubRuntimeEnvironment } from "../workhub-login";
import { apiErrorResponse } from "../http";

const ROUTE = "/api/admin/security-center";
const SCOPE_ID = "workhub-company";
const ACTION = "administration:manage";
const POLICY = { [ACTION]: ["system_admin"] };
interface Env { readonly DB: D1Database; readonly RUNTIME_ENVIRONMENT?: string }
const reject = (rid: string, status: number, code: string): Response =>
  apiErrorResponse({ status, code, message: status === 401 ? "Authentication required"
    : status === 403 ? "Access denied" : status === 405 ? "Method not allowed"
      : status === 400 ? "Invalid security center query" : "Security Center is unavailable" }, rid);

/** Safe projection for sources whose real CI results have not been connected. */
export const projectSecurityCenterReadModel = (asOf: string) => Object.freeze({
  schemaVersion: 1 as const,
  scopeId: SCOPE_ID,
  observedAt: asOf,
  evidenceBoundary: "no_live_security_source_connected" as const,
  findings: Object.freeze({
    availability: "not-checked" as const,
    verifiedCount: null,
    items: [] as readonly never[],
  }),
  sources: Object.freeze(SECURITY_SOURCE_KINDS.map(sourceKind =>
    Object.freeze({
      sourceKind,
      connection: "not-connected" as const,
      checkConclusion: null,
      coverage: normalizeSecuritySourceCoverage({
        sourceId: sourceKind.replaceAll("-", "_"),
        coverageState: "not-checked",
        sourceHealth: "unmonitored",
      }, asOf),
    }))),
});

/**
 * Read-only, per-request session and scope checked.
 * UI guards are not authorization. No external fetch or D1 data access
 * except the existing session and scope membership guards.
 */
export const handleSecurityCenterApi = async (
  request: Request, env: Env, requestId: string,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return null;
  if (request.method !== "GET") return reject(requestId, 405, "method_not_allowed");
  if ([...url.searchParams.keys()].some(k => k !== "scopeId")
    || url.searchParams.getAll("scopeId").length !== 1) {
    return reject(requestId, 400, "invalid_security_center_query");
  }
  if (url.searchParams.get("scopeId") !== SCOPE_ID) {
    return reject(requestId, 403, "forbidden");
  }
  // A missing remote environment is not treated as a valid local scan.
  try {
    resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
  } catch {
    return reject(requestId, 503, "runtime_environment_required");
  }
  let userId: string;
  try {
    const auth = await requireAuthenticatedUser(request, env.DB);
    if (!auth.allowed) return reject(requestId, 401, "authentication_required");
    userId = auth.user.id;
  } catch {
    return reject(requestId, 503, "authentication_unavailable");
  }
  try {
    const authz = await requireScopedAuthorization({
      db: env.DB, userId, policy: POLICY, action: ACTION,
      requestedScopeId: SCOPE_ID, resourceScopeId: SCOPE_ID,
    });
    if (!authz.allowed) return reject(requestId, 403, "forbidden");
  } catch {
    return reject(requestId, 503, "authorization_unavailable");
  }
  return Response.json(projectSecurityCenterReadModel(new Date().toISOString()), {
    headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  });
};
