import { isRuntimeEnvironment } from "../../shared/runtime";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import { apiErrorResponse } from "../http";

const INTEGRATION_VIEW_ACTION = "integrations:view";
const ROUTE = "/api/admin/integrations/outbox";
const MAX_RECENT = 8;
const MAX_SCOPE_LENGTH = 128;
const OUTBOX_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;

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

const safeFailureCode = (value: string | null): string =>
  value !== null && safeFailureCodes.has(value) ? value : "other";

type OutboxStatus = "pending" | "processing" | "retry_wait" | "delivered" | "dead_letter";

interface OutboxDetailRow {
  readonly id: string;
  readonly status: OutboxStatus;
  readonly attempt_count: number;
  readonly available_at: string;
  readonly last_attempt_at: string | null;
  readonly delivered_at: string | null;
  readonly dead_lettered_at: string | null;
  readonly failure_code: string | null;
  readonly version: number;
  readonly updated_at: string;
}

const nextAction = (status: OutboxStatus): "reconcile_external_first" | "await_scheduled_retry"
  | "observe_in_progress" | "queued" | "none" => {
  switch (status) {
    case "dead_letter": return "reconcile_external_first";
    case "retry_wait": return "await_scheduled_retry";
    case "processing": return "observe_in_progress";
    case "pending": return "queued";
    case "delivered": return "none";
  }
};

const validDetailRow = (row: OutboxDetailRow): boolean =>
  OUTBOX_ID_PATTERN.test(row.id)
  && ["pending", "processing", "retry_wait", "delivered", "dead_letter"].includes(row.status)
  && Number.isSafeInteger(row.attempt_count) && row.attempt_count >= 0
  && Number.isSafeInteger(row.version) && row.version > 0
  && typeof row.available_at === "string"
  && typeof row.updated_at === "string"
  && [row.last_attempt_at, row.delivered_at, row.dead_lettered_at].every(
    (value) => value === null || typeof value === "string",
  );

export const handleIntegrationOperationsApi = async (
  request: Request,
  env: IntegrationOperationsEnvironment,
  requestId: string,
  options: IntegrationOperationsOptions = {},
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE && !url.pathname.startsWith(ROUTE + "/")) return null;
  if (request.method !== "GET") return error(requestId, 405, "method_not_allowed", "Method not allowed");

  // Individual reads remain within the same authorized single-scope endpoint.
  let outboxId: string | null = null;
  if (url.pathname !== ROUTE) {
    const encodedId = url.pathname.slice(ROUTE.length + 1);
    try {
      outboxId = decodeURIComponent(encodedId);
    } catch {
      return error(requestId, 400, "invalid_integration_query", "Integration query is invalid");
    }
    if (!OUTBOX_ID_PATTERN.test(outboxId)) {
      return error(requestId, 400, "invalid_integration_query", "Integration query is invalid");
    }
  }

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
    if (outboxId !== null) {
      const detail = await env.DB.prepare(`
        SELECT id, status, attempt_count, available_at, last_attempt_at,
          delivered_at, dead_lettered_at, failure_code, version, updated_at
        FROM integration_outbox
        WHERE environment = ? AND id = ?
        LIMIT 1
      `).bind(environment, outboxId).first<OutboxDetailRow>();
      if (!detail) {
        return error(requestId, 404, "integration_outbox_not_found", "Outbox record not found");
      }
      if (!validDetailRow(detail)) throw new Error("Invalid Outbox detail");
      return response({
        coverage: "environment",
        environment,
        observedAt: new Date().toISOString(),
        outbox: {
          outboxId: detail.id,
          status: detail.status,
          attemptCount: detail.attempt_count,
          availableAt: detail.available_at,
          lastAttemptAt: detail.last_attempt_at,
          deliveredAt: detail.delivered_at,
          deadLetteredAt: detail.dead_lettered_at,
          updatedAt: detail.updated_at,
          version: detail.version,
          failureCode: safeFailureCode(detail.failure_code),
        },
        // This is guidance from local Outbox state, NOT an external provider check.
        decision: {
          nextAction: nextAction(detail.status),
          providerOutcome: "unverified",
          manualRetryAllowed: false,
          rationale: "Provider delivery outcome is not verified. Never re-send solely from Outbox status.",
        },
      });
    }

    // Snapshot of LOCAL Outbox states only. Due means eligible by available_at,
    // NOT a missed SLA or verified provider failure. No arbitrary alarm threshold.
    const observedAt = new Date().toISOString();
    const counts = await env.DB.prepare(`
      SELECT status, COUNT(*) AS total,
        SUM(CASE WHEN available_at <= ? THEN 1 ELSE 0 END) AS eligible,
        MIN(updated_at) AS oldest_updated_at
      FROM integration_outbox
      WHERE environment = ? AND status IN ('pending', 'processing', 'retry_wait', 'dead_letter')
      GROUP BY status
    `).bind(observedAt, environment).all<{
      status: string; total: number; eligible: number; oldest_updated_at: string | null;
    }>();
    let retryWait = 0;
    let deadLetter = 0;
    let duePending = 0;
    let dueRetryWait = 0;
    let processing = 0;
    let oldestProcessingUpdatedAt: string | null = null;
    for (const row of counts.results ?? []) {
      if (!Number.isSafeInteger(row.total) || row.total < 0
        || !Number.isSafeInteger(row.eligible) || row.eligible < 0 || row.eligible > row.total) {
        throw new Error("Invalid Outbox count");
      }
      if (row.status === "retry_wait") {
        retryWait = row.total;
        dueRetryWait = row.eligible;
      } else if (row.status === "dead_letter") deadLetter = row.total;
      else if (row.status === "pending") duePending = row.eligible;
      else if (row.status === "processing") {
        processing = row.total;
        if (row.oldest_updated_at !== null && typeof row.oldest_updated_at !== "string") {
          throw new Error("Invalid processing timestamp");
        }
        oldestProcessingUpdatedAt = row.oldest_updated_at;
      } else throw new Error("Unexpected Outbox status");
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
        failureCode: safeFailureCode(row.failure_code),
      };
    });
    const candidates = await env.DB.prepare(`
      SELECT id, status, attempt_count, updated_at, available_at, failure_code
      FROM integration_outbox
      WHERE environment = ? AND
        (status = 'processing'
          OR (status IN ('pending', 'retry_wait') AND available_at <= ?))
      ORDER BY updated_at ASC, id ASC
      LIMIT ?
    `).bind(environment, observedAt, MAX_RECENT).all<{
      id: string; status: string; attempt_count: number; updated_at: string;
      available_at: string; failure_code: string | null;
    }>();
    const attentionItems = (candidates.results ?? []).map((row) => {
      if ((row.status !== "pending" && row.status !== "processing" && row.status !== "retry_wait")
        || !OUTBOX_ID_PATTERN.test(row.id) || !Number.isSafeInteger(row.attempt_count)
        || row.attempt_count < 0 || typeof row.updated_at !== "string"
        || typeof row.available_at !== "string") throw new Error("Invalid Outbox candidate");
      if (row.status !== "processing" && row.available_at > observedAt) {
        throw new Error("Outbox candidate is not yet eligible");
      }
      return {
        outboxId: row.id, status: row.status, attemptCount: row.attempt_count,
        updatedAt: row.updated_at, availableAt: row.available_at,
        failureCode: safeFailureCode(row.failure_code),
      };
    });
    return response({
      coverage: "environment",
      environment,
      observedAt,
      counts: { retryWait, deadLetter },
      watch: { duePending, dueRetryWait, processing, oldestProcessingUpdatedAt },
      items,
      attentionItems,
      sampleLimit: MAX_RECENT,
    });
  } catch {
    return error(requestId, 503, "integration_operations_unavailable", "Integration operations are unavailable");
  }
};
