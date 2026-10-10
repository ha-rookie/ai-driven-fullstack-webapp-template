import { isRuntimeEnvironment } from "../../shared/runtime";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import { apiErrorResponse } from "../http";

const INTEGRATION_VIEW_ACTION = "integrations:view";
const ROUTE = "/api/admin/integrations/outbox";
const MAX_RECENT = 8;
const MAX_SCOPE_LENGTH = 128;

/** D1 Outbox has environment but no scope column. An explicit single-scope project opt-in is mandatory. */
export interface IntegrationOperationsOptions {
  readonly singleScopeSummaryId?: string;
  readonly authorizationPolicy?: RolePolicy;
}

export interface IntegrationOperationsEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}

const defaultPolicy: RolePolicy = {
  [INTEGRATION_VIEW_ACTION]: ["system_admin"],
};

const safeFailureCodes = new Set([
  "event_missing", "delivery_exception", "retryable_failure", "permanent_failure",
  "provider_unavailable", "destination_disabled",
]);

const error = (requestId: string, status: number, code: string, message: string): Response =>
  apiErrorResponse({ status, code, message }, requestId);

const response = (payload: unknown): Response =>
  Response.json(payload, { headers: { "cache-control": "no-store" } });

export const handleIntegrationOperationsApi = async (
  request: Request,
  env: IntegrationOperationsEnvironment,
  requestId: string,
  options: IntegrationOperationsOptions = {},
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return null;
  if (request.method !== "GET") return error(requestId, 405, "method_not_allowed", "Method not allowed");

  const environment = env.RUNTIME_ENVIRONMENT;
  if (!environment || !isRuntimeEnvironment(environment)) {
    return error(requestId, 503, "runtime_environment_required", "Runtime environment is unavailable");
  }

  // No arbitrary filters or pagination: a fixed, bounded operational observation only.
  if ([...url.searchParams.keys()].some((key) => key !== "scopeId")
    || url.searchParams.getAll("scopeId").length !== 1) {
    return error(requestId, 400, "invalid_integration_query", "Integration query is invalid");
  }
  const scopeId = url.searchParams.get("scopeId") ?? "";
  if (!scopeId || scopeId.trim() !== scopeId || scopeId.length > MAX_SCOPE_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(scopeId)) {
    return error(requestId, 400, "invalid_integration_query", "Integration query is invalid");
  }

  let auth;
  try {
    auth = await requireAuthenticatedUser(request, env.DB);
  } catch {
    return error(requestId, 503, "authentication_unavailable", "Authentication is unavailable");
  }
  if (!auth.allowed) return error(requestId, auth.status, auth.code, auth.message);

  try {
    const allowed = await requireScopedAuthorization({
      db: env.DB, userId: auth.user.id,
      policy: options.authorizationPolicy ?? defaultPolicy,
      action: INTEGRATION_VIEW_ACTION,
      requestedScopeId: scopeId, resourceScopeId: scopeId,
    });
    if (!allowed.allowed) return error(requestId, allowed.status, allowed.code, allowed.message);
  } catch {
    return error(requestId, 503, "authorization_unavailable", "Authorization is unavailable");
  }

  if (!options.singleScopeSummaryId || scopeId !== options.singleScopeSummaryId) {
    return error(requestId, 404, "integration_summary_unavailable", "Integration summary unavailable for this scope");
  }

  try {
    // Already-indexed environment/status columns; no payload or provider credentials read.
    const counts = await env.DB.prepare(`
      SELECT status, COUNT(*) AS total
      FROM integration_outbox
      WHERE environment = ? AND status IN ('retry_wait', 'dead_letter')
      GROUP BY status
    `).bind(environment).all<{ status: string; total: number }>();
    let retryWait = 0;
    let deadLetter = 0;
    for (const row of counts.results ?? []) {
      if (!Number.isSafeInteger(row.total) || row.total < 0) throw new Error("Invalid Outbox count");
      if (row.status === "retry_wait") retryWait = row.total;
      else if (row.status === "dead_letter") deadLetter = row.total;
      else throw new Error("Unexpected Outbox status");
    }

    const recent = await env.DB.prepare(`
      SELECT id, status, attempt_count, updated_at, failure_code
      FROM integration_outbox
      WHERE environment = ? AND status IN ('retry_wait', 'dead_letter')
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).bind(environment, MAX_RECENT).all<{
      id: string; status: string; attempt_count: number; updated_at: string; failure_code: string | null;
    }>();
    const items = (recent.results ?? []).map((row) => {
      if ((row.status !== "retry_wait" && row.status !== "dead_letter")
        || typeof row.id !== "string" || row.id.length > 191
        || !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0
        || typeof row.updated_at !== "string") throw new Error("Invalid Outbox row");
      // Provider failure_code can be an untrusted free-form value: never echo it raw.
      return {
        outboxId: row.id,
        status: row.status,
        attemptCount: row.attempt_count,
        updatedAt: row.updated_at,
        failureCode: safeFailureCodes.has(row.failure_code ?? "") ? row.failure_code : "other",
      };
    });
    return response({
      coverage: "environment",
      environment,
      observedAt: new Date().toISOString(),
      counts: { retryWait, deadLetter },
      items,
      sampleLimit: MAX_RECENT,
    });
  } catch {
    return error(requestId, 503, "integration_operations_unavailable", "Integration operations are unavailable");
  }
};
