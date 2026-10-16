import { resolveWorkhubRuntimeEnvironment } from "../workhub-login";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import { apiErrorResponse } from "../http";
import { decideOperationPolicy, OPERATIONS_POLICY_VERSION } from "../operations/policy";
import type { OperationDefinition, OperationRequest } from "../operations/types";
import { unmonitoredConnectionProjection } from "./integration-connection-projection";
import { D1IntegrationEventStore, assessOutboxProviderReceipt, type ProviderReceiptLookup } from "../integration-event";

const INTEGRATION_VIEW_ACTION = "integrations:view";
const ROUTE = "/api/admin/integrations/outbox";
const RECEIPT_SUFFIX = "/_receipt";
const FAILURE_PAGE_ROUTE = ROUTE + "/_failures";
const INBOUND_ROUTE = "/api/admin/integrations/inbound";
const INBOUND_FAILURE_PAGE_ROUTE = INBOUND_ROUTE + "/_failures";
const UNIFIED_FAILURE_ROUTE = "/api/admin/integrations/failures";
const INBOUND_PROVIDER_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;
const FAILURE_PAGE_SIZE = 20;
const MAX_RECENT = 8;
const MAX_SCOPE_LENGTH = 128;
const OUTBOX_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;

/**
 * #419: Shared #429 policy projects the retry risk, but provider receipt and
 * idempotency have NOT been verified. This read-only projection never grants an
 * execution capability or registers a handler; #429/#430 must gate any future Act.
 */
const DELIVERY_RETRY_DEFINITION: OperationDefinition = {
  id: "DELIVERY_RETRY",
  capability: "integrations:retry",
  baseRisk: "OPERATIONAL",
  reversible: false,
  idempotent: false,
  externalSideEffect: true,
  requiresVerification: true,
};
const INTEGRATION_RECONCILE_DEFINITION: OperationDefinition = {
  id: "INTEGRATION_RECONCILE",
  capability: "integrations:reconcile",
  baseRisk: "CONTROLLED_CHANGE",
  reversible: false,
  idempotent: false,
  externalSideEffect: true,
  requiresVerification: true,
};

/** Shared #429 policy evidence only. No executable preview or command handler. */
const blockedIntegrationOperationGate = (
  definition: OperationDefinition,
  blocker: "provider_receipt_unverified" | "provider_reconcile_adapter_not_registered",
  environment: OperationRequest["environment"],
  outboxId: string,
  scopeId: string,
  requestId: string,
) => {
  const preview = decideOperationPolicy({ allowed: false, reason: blocker }, {
    definition, actorKind: "HUMAN", environment,
    target: { resourceType: "integration_outbox", resourceId: outboxId, scopeId },
    affectedCount: 1, correlationId: requestId,
  });
  if (preview.policyDecision !== "DENY") throw new Error("Integration operation must be denied");
  return {
    operationId: preview.operationId,
    risk: preview.risk,
    policyDecision: preview.policyDecision,
    policyVersion: OPERATIONS_POLICY_VERSION,
    blocker,
    executionAllowed: false as const,
  };
};

/** D1 Outbox has environment but no scope column. An explicit single-scope project opt-in is mandatory. */
export interface IntegrationOperationsOptions {
  readonly singleScopeSummaryId?: string;
  readonly authorizationPolicy?: RolePolicy;
  /** Explicitly registered by the application only when #335 provides trusted Provider evidence. */
  readonly providerReceiptVerifier?: ProviderReceiptLookup;
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
  "provider_unavailable", "destination_disabled", "delivery_outcome_unknown",
]);

const error = (requestId: string, status: number, code: string, message: string): Response =>
  apiErrorResponse({ status, code, message }, requestId);

const response = (payload: unknown): Response =>
  Response.json(payload, { headers: { "cache-control": "no-store" } });

const safeFailureCode = (value: string | null): string =>
  value !== null && safeFailureCodes.has(value) ? value : "other";

// A verifier/mapper may emit arbitrary diagnostic codes. Do not echo them.
const inboundFailureCodes = new Set(["business_processing_failed", "other"]);
const safeInboundFailureCode = (value: string | null): string =>
  value !== null && inboundFailureCodes.has(value) ? value : "other";

interface InboundFailureRow {
  readonly id: string;
  readonly provider_key: string;
  readonly status: string;
  readonly attempt_count: number;
  readonly received_at: string;
  readonly updated_at: string;
  readonly failure_code: string | null;
  readonly version: number;
}

const validInboundFailureRow = (row: InboundFailureRow): boolean =>
  OUTBOX_ID_PATTERN.test(row.id) && INBOUND_PROVIDER_PATTERN.test(row.provider_key)
  && (row.status === "failed" || row.status === "dead_letter")
  && Number.isSafeInteger(row.attempt_count) && row.attempt_count >= 0
  && Number.isSafeInteger(row.version) && row.version > 0
  && [row.received_at, row.updated_at].every(
    (value) => typeof value === "string" && value.length <= 64
      && Number.isFinite(Date.parse(value)),
  );

const inboundFailureProjection = (row: InboundFailureRow) => {
  if (!validInboundFailureRow(row)) throw new Error("Invalid inbound failure row");
  return {
    receiptId: row.id, providerKey: row.provider_key, status: row.status,
    attemptCount: row.attempt_count, receivedAt: row.received_at,
    updatedAt: row.updated_at, version: row.version,
    failureCode: safeInboundFailureCode(row.failure_code),
  };
};

/** Keyset cursor matches the existing Audit read-only pagination approach. */
interface FailureCursor { readonly updatedAt: string; readonly id: string }
const encodeFailureCursor = (cursor: FailureCursor): string =>
  btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const decodeFailureCursor = (value: string | null): FailureCursor | null => {
  if (value === null) return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) throw new TypeError("Invalid failure cursor");
  try {
    const b64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid cursor");
    const fields = parsed as Record<string, unknown>;
    if (typeof fields.updatedAt !== "string" || fields.updatedAt.length > 64
      || !Number.isFinite(Date.parse(fields.updatedAt))
      || typeof fields.id !== "string" || !OUTBOX_ID_PATTERN.test(fields.id)) {
      throw new TypeError("Invalid cursor fields");
    }
    return { updatedAt: fields.updatedAt, id: fields.id };
  } catch { throw new TypeError("Invalid failure cursor"); }
};

/**
 * #419: A single bounded work queue over two existing LOCAL failure stores.
 * Separate 21-row index-backed queries avoid scanning or buffering whole tables.
 * Provider-side failures, pre-verification webhook rejection and #335 storage
 * do not enter this result. Each entry opens its existing authorized detail.
 */
type LocalFailureSource = "outbound_delivery" | "inbound_webhook";
interface UnifiedFailureCursor extends FailureCursor { readonly source: LocalFailureSource }
interface UnifiedOutboundFailureRow {
  readonly id: string;
  readonly status: string;
  readonly attempt_count: number;
  readonly updated_at: string;
  readonly failure_code: string | null;
  readonly version: number;
}
const sourceValid = (value: unknown): value is LocalFailureSource =>
  value === "outbound_delivery" || value === "inbound_webhook";
const encodeUnifiedFailureCursor = (value: UnifiedFailureCursor): string =>
  btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const decodeUnifiedFailureCursor = (value: string | null): UnifiedFailureCursor | null => {
  if (value === null) return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) throw new TypeError("Invalid failure cursor");
  try {
    const b64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid cursor");
    const fields = parsed as Record<string, unknown>;
    if (!sourceValid(fields.source) || typeof fields.updatedAt !== "string"
      || fields.updatedAt.length > 64 || !Number.isFinite(Date.parse(fields.updatedAt))
      || typeof fields.id !== "string" || !OUTBOX_ID_PATTERN.test(fields.id)) {
      throw new TypeError("Invalid failure cursor fields");
    }
    return { updatedAt: fields.updatedAt, source: fields.source, id: fields.id };
  } catch { throw new TypeError("Invalid failure cursor"); }
};
const descending = (a: string, b: string): number => a > b ? -1 : a < b ? 1 : 0;
/** Match ORDER BY updated_at DESC, source DESC, id DESC using SQLite's binary ordering. */
const unifiedCursorWhere = (source: LocalFailureSource, cursor: UnifiedFailureCursor | null) => {
  if (!cursor) return { sql: "", args: [] as string[] };
  if (source === cursor.source) {
    return {
      sql: " AND (updated_at < ? OR (updated_at = ? AND id < ?))",
      args: [cursor.updatedAt, cursor.updatedAt, cursor.id],
    };
  }
  return source < cursor.source
    ? { sql: " AND updated_at <= ?", args: [cursor.updatedAt] }
    : { sql: " AND updated_at < ?", args: [cursor.updatedAt] };
};

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
  const inboundRoute = url.pathname === INBOUND_ROUTE || url.pathname.startsWith(INBOUND_ROUTE + "/");
  const unifiedFailureRoute = url.pathname === UNIFIED_FAILURE_ROUTE;
  const receiptRoute = url.pathname.startsWith(ROUTE + "/")
    && url.pathname.endsWith(RECEIPT_SUFFIX);
  if (!unifiedFailureRoute && !inboundRoute
    && url.pathname !== ROUTE && !url.pathname.startsWith(ROUTE + "/")) return null;
  if (request.method !== "GET") return error(requestId, 405, "method_not_allowed", "Method not allowed");

  // Both read families inherit the existing single-Scope/Environment guard.
  let outboxId: string | null = null;
  let inboundReceiptId: string | null = null;
  const failurePage = url.pathname === FAILURE_PAGE_ROUTE;
  const inboundFailurePage = url.pathname === INBOUND_FAILURE_PAGE_ROUTE;
  if (inboundRoute && url.pathname === INBOUND_ROUTE) {
    return error(requestId, 404, "integration_summary_unavailable", "Integration summary unavailable");
  }
  if (inboundRoute && !inboundFailurePage) {
    const encodedId = url.pathname.slice(INBOUND_ROUTE.length + 1);
    try { inboundReceiptId = decodeURIComponent(encodedId); }
    catch { return error(requestId, 400, "invalid_integration_query", "Integration query is invalid"); }
    if (!OUTBOX_ID_PATTERN.test(inboundReceiptId)) {
      return error(requestId, 400, "invalid_integration_query", "Integration query is invalid");
    }
  } else if (!inboundRoute && url.pathname !== ROUTE && !failurePage) {
    const encodedId = url.pathname.slice(ROUTE.length + 1,
      receiptRoute ? -RECEIPT_SUFFIX.length : undefined);
    try { outboxId = decodeURIComponent(encodedId); }
    catch { return error(requestId, 400, "invalid_integration_query", "Integration query is invalid"); }
    if (!OUTBOX_ID_PATTERN.test(outboxId)) {
      return error(requestId, 400, "invalid_integration_query", "Integration query is invalid");
    }
  }

  // Same local-only resolution as the WORKHUB login/Overview route.
  // A remote hostname with missing or invalid runtime configuration still fails closed.
  let environment: string;
  try {
    environment = resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
  } catch {
    return error(requestId, 503, "runtime_environment_required", "Runtime environment is unavailable");
  }

  // No arbitrary filters or pagination: a fixed, bounded operational observation only.
  if ([...url.searchParams.keys()].some((key) =>
    key !== "scopeId" && !((failurePage || inboundFailurePage || unifiedFailureRoute) && key === "cursor"))
    || url.searchParams.getAll("scopeId").length !== 1
    || url.searchParams.getAll("cursor").length > 1) {
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
    if (unifiedFailureRoute) {
      let cursor: UnifiedFailureCursor | null;
      try { cursor = decodeUnifiedFailureCursor(url.searchParams.get("cursor")); }
      catch { return error(requestId, 400, "invalid_integration_query", "Integration query is invalid"); }
      const outgoing = unifiedCursorWhere("outbound_delivery", cursor);
      const incoming = unifiedCursorWhere("inbound_webhook", cursor);
      // Each source is independently bounded by the existing indexed time order.
      // Failure in either source fails the WHOLE queue closed (not falsely empty).
      const [outboxRows, inboundRows] = await Promise.all([
        env.DB.prepare(`
          SELECT id, status, attempt_count, updated_at, failure_code, version
          FROM integration_outbox
          WHERE environment = ? AND status IN ('retry_wait', 'dead_letter')
            ${outgoing.sql}
          ORDER BY updated_at DESC, id DESC LIMIT ?
        `).bind(environment, ...outgoing.args, FAILURE_PAGE_SIZE + 1).all<UnifiedOutboundFailureRow>(),
        env.DB.prepare(`
          SELECT id, provider_key, status, attempt_count, received_at,
            updated_at, failure_code, version
          FROM inbound_webhook_receipts
          WHERE environment = ? AND status IN ('failed', 'dead_letter')
            ${incoming.sql}
          ORDER BY updated_at DESC, id DESC LIMIT ?
        `).bind(environment, ...incoming.args, FAILURE_PAGE_SIZE + 1).all<InboundFailureRow>(),
      ]);
      const outbound = (outboxRows.results ?? []).map(row => {
        if (!OUTBOX_ID_PATTERN.test(row.id)
          || (row.status !== "retry_wait" && row.status !== "dead_letter")
          || !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0
          || !Number.isSafeInteger(row.version) || row.version < 1
          || typeof row.updated_at !== "string" || row.updated_at.length > 64
          || !Number.isFinite(Date.parse(row.updated_at))) throw new Error("Invalid outbound failure");
        return {
          source: "outbound_delivery" as const, id: row.id, status: row.status,
          attemptCount: row.attempt_count, updatedAt: row.updated_at,
          version: row.version, failureCode: safeFailureCode(row.failure_code),
          providerKey: null,
        };
      });
      const inbound = (inboundRows.results ?? []).map(row => {
        const safe = inboundFailureProjection(row);
        return {
          source: "inbound_webhook" as const, id: safe.receiptId,
          status: safe.status, attemptCount: safe.attemptCount,
          updatedAt: safe.updatedAt, version: safe.version,
          failureCode: safe.failureCode, providerKey: safe.providerKey,
        };
      });
      if (outbound.length > FAILURE_PAGE_SIZE + 1 || inbound.length > FAILURE_PAGE_SIZE + 1) {
        throw new Error("Failure queue query exceeded bound");
      }
      const sorted = [...outbound, ...inbound].sort((a, b) =>
        descending(a.updatedAt, b.updatedAt)
        || descending(a.source, b.source)
        || descending(a.id, b.id));
      const items = sorted.slice(0, FAILURE_PAGE_SIZE);
      const last = items.at(-1);
      return response({
        coverage: "environment", source: "local_failure_queue",
        environment, observedAt: new Date().toISOString(),
        pageLimit: FAILURE_PAGE_SIZE, sources: ["outbound_delivery", "inbound_webhook"],
        items, nextCursor: sorted.length > FAILURE_PAGE_SIZE && last
          ? encodeUnifiedFailureCursor({
            updatedAt: last.updatedAt, source: last.source, id: last.id,
          }) : null,
        providerReceipt: "unverified", manualRetryAllowed: false,
      });
    }
    // Read actual persisted inbound webhook failures, not provider monitoring.
    // A receipt records no raw body; there is intentionally no replay action.
    if (inboundFailurePage) {
      let cursor: FailureCursor | null;
      try { cursor = decodeFailureCursor(url.searchParams.get("cursor")); }
      catch { return error(requestId, 400, "invalid_integration_query", "Integration query is invalid"); }
      const sql = `
        SELECT id, provider_key, status, attempt_count, received_at,
          updated_at, failure_code, version
        FROM inbound_webhook_receipts
        WHERE environment = ? AND status IN ('failed', 'dead_letter')
          ${cursor ? "AND (updated_at < ? OR (updated_at = ? AND id < ?))" : ""}
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `;
      const args: (string | number)[] = [environment];
      if (cursor) args.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
      args.push(FAILURE_PAGE_SIZE + 1);
      const result = await env.DB.prepare(sql).bind(...args).all<InboundFailureRow>();
      const rows = result.results ?? [];
      if (rows.length > FAILURE_PAGE_SIZE + 1) throw new Error("Inbound failure page exceeds bound");
      const hasMore = rows.length > FAILURE_PAGE_SIZE;
      const items = rows.slice(0, FAILURE_PAGE_SIZE).map(inboundFailureProjection);
      const last = items.at(-1);
      return response({
        coverage: "environment", source: "local_inbound_receipt",
        environment, observedAt: new Date().toISOString(),
        pageLimit: FAILURE_PAGE_SIZE, items,
        nextCursor: hasMore && last
          ? encodeFailureCursor({ updatedAt: last.updatedAt, id: last.receiptId }) : null,
        replayAvailable: false,
      });
    }
    if (inboundReceiptId !== null) {
      const row = await env.DB.prepare(`
        SELECT id, provider_key, status, attempt_count, received_at,
          updated_at, failure_code, version
        FROM inbound_webhook_receipts
        WHERE environment = ? AND id = ? AND status IN ('failed', 'dead_letter')
        LIMIT 1
      `).bind(environment, inboundReceiptId).first<InboundFailureRow>();
      if (!row) return error(requestId, 404, "inbound_receipt_not_found", "Inbound receipt not found");
      return response({
        coverage: "environment", source: "local_inbound_receipt",
        environment, observedAt: new Date().toISOString(),
        receipt: inboundFailureProjection(row),
        decision: {
          nextAction: "inspect_processing_failure",
          manualRetryAllowed: false, replayAvailable: false,
          rationale: "Verified receipt metadata cannot safely replay a provider event.",
        },
      });
    }
    if (failurePage) {
      // The exact same authorized single-Scope/Environment boundary as the
      // existing Outbox summary and detail. Never expose destination/payload.
      let cursor: FailureCursor | null;
      try { cursor = decodeFailureCursor(url.searchParams.get("cursor")); }
      catch { return error(requestId, 400, "invalid_integration_query", "Integration query is invalid"); }
      const sql = `
        SELECT id, status, attempt_count, updated_at, failure_code
        FROM integration_outbox
        WHERE environment = ? AND status IN ('retry_wait', 'dead_letter')
          ${cursor ? "AND (updated_at < ? OR (updated_at = ? AND id < ?))" : ""}
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `;
      const args: (string | number)[] = [environment];
      if (cursor) args.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
      args.push(FAILURE_PAGE_SIZE + 1);
      const page = await env.DB.prepare(sql).bind(...args).all<{
        id: string; status: string; attempt_count: number;
        updated_at: string; failure_code: string | null;
      }>();
      const rows = page.results ?? [];
      if (rows.length > FAILURE_PAGE_SIZE + 1) throw new Error("Outbox page exceeds limit");
      const hasMore = rows.length > FAILURE_PAGE_SIZE;
      const items = rows.slice(0, FAILURE_PAGE_SIZE).map((row) => {
        if (!OUTBOX_ID_PATTERN.test(row.id)
          || (row.status !== "retry_wait" && row.status !== "dead_letter")
          || !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0
          || typeof row.updated_at !== "string" || row.updated_at.length > 64
          || !Number.isFinite(Date.parse(row.updated_at))) {
          throw new Error("Invalid failure row");
        }
        return {
          outboxId: row.id, status: row.status,
          attemptCount: row.attempt_count, updatedAt: row.updated_at,
          failureCode: safeFailureCode(row.failure_code),
        };
      });
      const last = items.at(-1);
      return response({
        coverage: "environment", environment, observedAt: new Date().toISOString(),
        pageLimit: FAILURE_PAGE_SIZE, items,
        nextCursor: hasMore && last
          ? encodeFailureCursor({ updatedAt: last.updatedAt, id: last.outboxId }) : null,
        providerReceipt: "unverified",
      });
    }
    if (receiptRoute && outboxId !== null) {
      // #419: expose the existing #719 read-only evidence assessment only behind
      // this same authenticated, single-scope, environment-bound GET route.
      // No verifier is registered in the reference deployment: this returns
      // unverified, never a fabricated Provider receipt or a retry permission.
      const assessment = await assessOutboxProviderReceipt({
        environment, outboxId, store: new D1IntegrationEventStore(env.DB),
        verifier: options.providerReceiptVerifier,
      });
      if (assessment.kind === "missing") {
        return error(requestId, 404, "integration_outbox_not_found", "Outbox record not found");
      }
      return response({
        coverage: "environment", environment, outboxId,
        observedAt: new Date().toISOString(), assessment,
      });
    }
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
          operationGate: blockedIntegrationOperationGate(
            DELIVERY_RETRY_DEFINITION, "provider_receipt_unverified",
            environment as OperationRequest["environment"], detail.id, scopeId, requestId,
          ),
          // No #335 Provider receipt adapter exists. Reconciliation is also DENY.
          reconcileGate: blockedIntegrationOperationGate(
            INTEGRATION_RECONCILE_DEFINITION, "provider_reconcile_adapter_not_registered",
            environment as OperationRequest["environment"], detail.id, scopeId, requestId,
          ),
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
    // #419: latest locally recorded terminal-state updates, NOT provider receipts.
    // Reuse the existing environment + status index; never infer connection health.
    const history = await env.DB.prepare(`
      SELECT status, MAX(updated_at) AS latest_updated_at
      FROM integration_outbox
      WHERE environment = ? AND status IN ('delivered', 'dead_letter')
      GROUP BY status
    `).bind(environment).all<{ status: string; latest_updated_at: string | null }>();
    let lastDeliveredUpdatedAt: string | null = null;
    let lastDeadLetterUpdatedAt: string | null = null;
    for (const row of history.results ?? []) {
      if (!["delivered", "dead_letter"].includes(row.status)
        || typeof row.latest_updated_at !== "string"
        || row.latest_updated_at.length > 64
        || !Number.isFinite(Date.parse(row.latest_updated_at))) {
        throw new Error("Invalid local delivery timestamp");
      }
      if (row.status === "delivered") lastDeliveredUpdatedAt = row.latest_updated_at;
      else lastDeadLetterUpdatedAt = row.latest_updated_at;
    }

    return response({
      coverage: "environment",
      environment,
      observedAt,
      counts: { retryWait, deadLetter },
      watch: { duePending, dueRetryWait, processing, oldestProcessingUpdatedAt },
      items,
      attentionItems,
      sampleLimit: MAX_RECENT,
      deliveryEvidence: {
        kind: "local_outbox_state",
        lastDeliveredUpdatedAt,
        lastDeadLetterUpdatedAt,
        providerReceipt: "unverified",
      },
      connectionStatus: unmonitoredConnectionProjection(),
    });
  } catch {
    return error(requestId, 503, "integration_operations_unavailable", "Integration operations are unavailable");
  }
};
