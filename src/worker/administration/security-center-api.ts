import { requireAuthenticatedUser, requireScopedAuthorization } from "../authorization";
import { apiErrorResponse } from "../http";
import { resolveWorkhubRuntimeEnvironment } from "../workhub-login";
import { normalizeSecuritySourceCoverage } from "../../shared/security/security-finding";
import scsMapping from "../../../config/scs-control-mapping.json";

/** #420: bounded read-only, authenticated, scoped evidence-status projection.
 * This is NOT a scanner, Finding feed, SCS certification or audit verdict.
 */
const SCOPE = "workhub-company";
const ROUTE = "/api/admin/security/center";
const ACTION = "administration:manage";
const POLICY = { [ACTION]: ["system_admin"] };
const SOURCE_IDS = ["secret_detection", "dependency_audit", "configuration_check", "scs_control_mapping"] as const;

interface Env { readonly DB: D1Database; readonly RUNTIME_ENVIRONMENT?: string }
const reject = (requestId: string, status: number, code: string): Response =>
  apiErrorResponse({ status, code, message: status === 401 ? "Authentication required"
    : status === 403 ? "Access denied" : status === 405 ? "Method not allowed"
      : status === 400 ? "Invalid Security Center query" : "Security Center unavailable" }, requestId);

export const projectSecurityCenter = (asOf: string) => ({
  schemaVersion: 1 as const,
  scopeId: SCOPE,
  observedAt: asOf,
  posture: "not-assessed" as const,
  findings: { state: "not-connected" as const, items: null, verifiedCount: null },
  sources: SOURCE_IDS.map((sourceId) => normalizeSecuritySourceCoverage({
    sourceId, coverageState: "not-checked", sourceHealth: "unmonitored",
  }, asOf)),
  scs: {
    sourceVerifiedAt: scsMapping.source.verifiedAt,
    certification: "not-assessed" as const,
    requirements: scsMapping.requirements.map(({ id, level, name, status, control, test, evidence }) => ({
      id, level, name, responsibility: status, control,
      testReference: test || null, evidenceReference: evidence || null,
      evidenceFreshness: "unknown" as const, finding: null, remediation: null,
    })),
  },
});

export const handleSecurityCenterApi = async (
  request: Request, env: Env, requestId: string,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return null;
  if (request.method !== "GET") return reject(requestId, 405, "method_not_allowed");
  if (url.searchParams.size !== 1 || url.searchParams.getAll("scopeId").length !== 1
    || url.searchParams.get("scopeId") !== SCOPE) {
    return reject(requestId, 400, "invalid_security_center_query");
  }
  // Fail closed when a real runtime context is absent; never substitute a synthetic scan.
  try {
    resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
  } catch {
    return reject(requestId, 503, "runtime_environment_required");
  }
  let actorId: string;
  try {
    const authentication = await requireAuthenticatedUser(request, env.DB);
    if (!authentication.allowed) return reject(requestId, 401, "authentication_required");
    actorId = authentication.user.id;
  } catch {
    return reject(requestId, 503, "authentication_unavailable");
  }
  try {
    const authz = await requireScopedAuthorization({
      db: env.DB, userId: actorId, policy: POLICY, action: ACTION,
      requestedScopeId: SCOPE, resourceScopeId: SCOPE,
    });
    if (!authz.allowed) return reject(requestId, 403, "forbidden");
  } catch {
    return reject(requestId, 503, "authorization_unavailable");
  }
  try {
    return Response.json(projectSecurityCenter(new Date().toISOString()), {
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return reject(requestId, 503, "security_center_unavailable");
  }
};
