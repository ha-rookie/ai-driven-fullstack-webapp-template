import { resolveWorkhubRuntimeEnvironment } from "../workhub-login";
import { requireAuthenticatedUser, requireScopedAuthorization } from "../authorization";
import { apiErrorResponse } from "../http";
import { handleReadiness } from "../health";
import { handleJobOperationsApi } from "./job-operations-api";
import { handleIntegrationOperationsApi } from "./integration-operations-api";
import { handleAuditLogViewerApi } from "./audit-log-viewer-api";
import { handleMasterDataViewerApi, type MasterDataViewerOptions } from "./master-data-viewer-api";

/**
 * #414: a single, bounded, read-only cross-domain projection for the WORKHUB
 * reference portal. Each source is called through its EXISTING authenticated,
 * scoped API handler. No new SQL, data mutation, generic resource selectors or
 * shortcut authorization. This contract is NOT a monitoring source of truth.
 */
const SCOPE = "workhub-company";
const ROUTE = "/api/admin/operations/overview";
const ACTION = "administration:manage";
const POLICY = { [ACTION]: ["system_admin"] };
const AUDIT_LIMIT = 20;
const OUTBOX_LIMIT = 8;
const safeCode = new Set(["event_missing", "delivery_exception", "retryable_failure",
  "permanent_failure", "provider_unavailable", "destination_disabled", "other"]);

interface Env { readonly DB: D1Database; readonly RUNTIME_ENVIRONMENT?: string }
type Probe = { readonly kind: "ready"; readonly data: unknown }
  | { readonly kind: "denied" } | { readonly kind: "unknown" };
type SourceKey = "jobs" | "outbox" | "auditFailures" | "privileged" | "master" | "database";
export type OverviewSourceResponses = Readonly<Record<SourceKey, Response | null>>;
interface Options { readonly masterViewer: MasterDataViewerOptions }

const reject = (requestId: string, status: number, code: string): Response =>
  apiErrorResponse({ status, code, message: status === 401 ? "Authentication required"
    : status === 403 ? "Access denied" : status === 405 ? "Method not allowed"
      : status === 400 ? "Overview query is invalid" : "Overview is unavailable" }, requestId);

const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const nonnegative = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const plain = (x: unknown): x is string =>
  typeof x === "string" && x.length > 0 && x.length <= 191;
const stamp = (x: unknown): x is string =>
  typeof x === "string" && x.length <= 64 && x.length > 0;

const projectJobs = (x: unknown): unknown | null => {
  if (!record(x) || x.coverage !== "environment" || !plain(x.environment)
    || !stamp(x.observedAt) || !record(x.counts)) return null;
  const { failed, deadLetter } = x.counts;
  if (!nonnegative(failed) || !nonnegative(deadLetter)
    || !Number.isSafeInteger(failed + deadLetter)) return null;
  return { coverage: "environment", environment: x.environment,
    observedAt: x.observedAt, counts: { failed, deadLetter } };
};

const projectAudit = (x: unknown): unknown | null => {
  if (!record(x) || !Array.isArray(x.items) || x.items.length > AUDIT_LIMIT
    || !(x.nextCursor === null || plain(x.nextCursor))) return null;
  const items: Array<{ category: string; action: string }> = [];
  for (const item of x.items) {
    if (!record(item) || !plain(item.category) || !plain(item.action)) return null;
    // IDs, actors, reasons, request metadata and raw Audit payloads are excluded.
    items.push({ category: item.category, action: item.action });
  }
  return { items, nextCursor: x.nextCursor };
};

const projectMaster = (x: unknown): unknown | null =>
  record(x) && plain(x.environment) && stamp(x.asOf)
    ? { environment: x.environment, asOf: x.asOf } : null;

const projectDatabase = (x: unknown): unknown | null =>
  record(x) && x.component === "database" && (x.status === "ok" || x.status === "unavailable")
    ? { component: "database", status: x.status } : null;

const projectOutbox = (x: unknown): unknown | null => {
  if (!record(x) || x.coverage !== "environment" || !plain(x.environment)
    || !stamp(x.observedAt) || !record(x.counts) || !record(x.watch)
    || !nonnegative(x.counts.retryWait) || !nonnegative(x.counts.deadLetter)
    || !nonnegative(x.watch.duePending) || !nonnegative(x.watch.dueRetryWait)
    || !nonnegative(x.watch.processing)
    || x.watch.dueRetryWait > x.counts.retryWait
    || !Number.isSafeInteger(x.counts.retryWait + x.counts.deadLetter)
    || !(x.watch.oldestProcessingUpdatedAt === null || stamp(x.watch.oldestProcessingUpdatedAt))
    || x.sampleLimit !== OUTBOX_LIMIT || !Array.isArray(x.items)
    || !Array.isArray(x.attentionItems) || x.items.length > OUTBOX_LIMIT
    || x.attentionItems.length > OUTBOX_LIMIT) return null;
  const projectItem = (input: unknown, attention: boolean) => {
    if (!record(input) || !plain(input.outboxId) || !nonnegative(input.attemptCount)
      || !stamp(input.updatedAt) || !plain(input.failureCode)
      || !safeCode.has(input.failureCode)) return null;
    if (attention) {
      if (input.status !== "pending" && input.status !== "processing"
        && input.status !== "retry_wait") return null;
      if (!stamp(input.availableAt)) return null;
      return { outboxId: input.outboxId, status: input.status,
        attemptCount: input.attemptCount, updatedAt: input.updatedAt,
        availableAt: input.availableAt, failureCode: input.failureCode };
    }
    if (input.status !== "retry_wait" && input.status !== "dead_letter") return null;
    return { outboxId: input.outboxId, status: input.status,
      attemptCount: input.attemptCount, updatedAt: input.updatedAt,
      failureCode: input.failureCode };
  };
  const items = x.items.map(item => projectItem(item, false));
  const attentionItems = x.attentionItems.map(item => projectItem(item, true));
  if (items.some(item => item === null) || attentionItems.some(item => item === null)) return null;
  return { coverage: "environment", environment: x.environment, observedAt: x.observedAt,
    counts: { retryWait: x.counts.retryWait, deadLetter: x.counts.deadLetter },
    watch: { duePending: x.watch.duePending, dueRetryWait: x.watch.dueRetryWait,
      processing: x.watch.processing, oldestProcessingUpdatedAt: x.watch.oldestProcessingUpdatedAt },
    sampleLimit: OUTBOX_LIMIT, items, attentionItems };
};

const projectors: Readonly<Record<SourceKey, (value: unknown) => unknown | null>> = {
  jobs: projectJobs, outbox: projectOutbox, auditFailures: projectAudit,
  privileged: projectAudit, master: projectMaster, database: projectDatabase,
};

const toProbe = async (response: Response | null, source: SourceKey): Promise<Probe> => {
  if (!response) return { kind: "unknown" };
  if (response.status === 401 || response.status === 403) return { kind: "denied" };
  if (!response.ok && !(source === "database" && response.status === 503)) {
    return { kind: "unknown" };
  }
  try {
    const projected = projectors[source](await response.json() as unknown);
    return projected === null ? { kind: "unknown" } : { kind: "ready", data: projected };
  } catch {
    return { kind: "unknown" };
  }
};

/** Testable safe projection: responses may be malformed or include sensitive fields. */
export const projectOperationsOverviewSources = async (responses: OverviewSourceResponses) => {
  const [jobs, outbox, auditFailures, privileged, master, database] = await Promise.all([
    toProbe(responses.jobs, "jobs"), toProbe(responses.outbox, "outbox"),
    toProbe(responses.auditFailures, "auditFailures"), toProbe(responses.privileged, "privileged"),
    toProbe(responses.master, "master"), toProbe(responses.database, "database"),
  ]);
  return { schemaVersion: 1 as const, scopeId: SCOPE,
    jobs, outbox, auditFailures, privileged, master, database,
    updatedAt: new Date().toISOString() };
};

export const handleWorkhubOperationsOverviewApi = async (
  request: Request, env: Env, requestId: string, options: Options,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return null;
  if (request.method !== "GET") return reject(requestId, 405, "method_not_allowed");
  if ([...url.searchParams.keys()].some(key => key !== "scopeId")
    || url.searchParams.getAll("scopeId").length !== 1) {
    return reject(requestId, 400, "invalid_overview_query");
  }
  if (url.searchParams.get("scopeId") !== SCOPE || options.masterViewer.scopeId !== SCOPE) {
    return reject(requestId, 403, "forbidden");
  }
  // Local Vite/Workers can omit RUNTIME_ENVIRONMENT. Use the established
  // WORKHUB resolver: local hostname => local; non-local needs explicit config.
  let sourceEnv: Env;
  try {
    sourceEnv = { DB: env.DB,
      RUNTIME_ENVIRONMENT: resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT) };
  } catch {
    return reject(requestId, 503, "runtime_environment_required");
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
    const decision = await requireScopedAuthorization({
      db: env.DB, userId: actorId, policy: POLICY, action: ACTION,
      requestedScopeId: SCOPE, resourceScopeId: SCOPE,
    });
    if (!decision.allowed) return reject(requestId, 403, "forbidden");
  } catch {
    return reject(requestId, 503, "authorization_unavailable");
  }

  // Bounded, fixed-route internal calls. Existing handlers apply their OWN
  // per-source policy; denied sources cannot be turned into a healthy zero.
  const headers = new Headers();
  for (const header of ["cookie", "authorization"]) {
    const value = request.headers.get(header);
    if (value) headers.set(header, value);
  }
  const internal = (path: string) => new Request(new URL(path, request.url), { headers });
  const call = async (run: () => Promise<Response | null>): Promise<Response | null> => {
    try { return await run(); } catch { return null; }
  };
  const scoped = "?scopeId=" + SCOPE;
  const [jobs, outbox, auditFailures, privileged, master, database] = await Promise.all([
    call(() => handleJobOperationsApi(internal("/api/admin/jobs/summary" + scoped), sourceEnv, requestId,
      { singleScopeSummaryId: SCOPE })),
    call(() => handleIntegrationOperationsApi(internal("/api/admin/integrations/outbox" + scoped),
      sourceEnv, requestId, { singleScopeSummaryId: SCOPE })),
    call(() => handleAuditLogViewerApi(internal("/api/admin/audit" + scoped + "&outcome=failure&limit=20"),
      sourceEnv, requestId)),
    call(() => handleAuditLogViewerApi(internal("/api/admin/audit" + scoped + "&category=system&limit=20"),
      sourceEnv, requestId)),
    call(() => handleMasterDataViewerApi(internal("/api/admin/master-data" + scoped
      + "&masterKey=workhub.office"), sourceEnv, requestId, options.masterViewer)),
    call(() => handleReadiness(env.DB)),
  ]);
  const payload = await projectOperationsOverviewSources({
    jobs, outbox, auditFailures, privileged, master, database,
  });
  return Response.json(payload, { headers: {
    "cache-control": "no-store", "content-type": "application/json; charset=utf-8",
  } });
};
