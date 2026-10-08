import { isRuntimeEnvironment, type RuntimeEnvironment } from "../../shared/runtime";
import type { AsyncJobState } from "../../shared/async-job";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import { consoleAuditLogger, type AuditLogger } from "../audit";
import { apiErrorResponse, readJsonBody, requireCsrfProtection, csrfGuardFailureResponse } from "../http";
import {
  OperationRegistry,
  OperationsApplicationService,
  OPERATIONS_POLICY_VERSION,
  type OperationRequest,
} from "../operations";
import {
  JOB_RETRY_OPERATION,
  JobRecoveryRegistry,
  createJobRetryOperationHandler,
  type RecoverableJobRecord,
} from "./job-recovery";

const JOB_VIEW_ACTION = "jobs:view";
const JOB_RETRY_ACTION = "jobs:retry";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_FILTER_LENGTH = 128;

const defaultAuthorizationPolicy: RolePolicy = {
  [JOB_VIEW_ACTION]: ["system_admin"],
  [JOB_RETRY_ACTION]: ["system_admin"],
};

export interface JobOperationsEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}

export interface JobOperationsApiOptions {
  readonly authorizationPolicy?: RolePolicy;
  readonly recoveryRegistry?: JobRecoveryRegistry;
  readonly auditLogger?: AuditLogger;
}

interface JobRow {
  readonly job_id: string;
  readonly job_type: string;
  readonly idempotency_key: string;
  readonly state: AsyncJobState;
  readonly attempt: number;
  readonly requested_at: string;
  readonly started_at: string | null;
  readonly updated_at: string;
  readonly completed_at: string | null;
  readonly next_attempt_at: string | null;
  readonly progress_percent: number | null;
  readonly progress_code: string | null;
  readonly failure_code: string | null;
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

const error = (requestId: string, status: number, code: string, message: string): Response =>
  apiErrorResponse({ status, code, message }, requestId);

const bounded = (value: string | null, maxLength = MAX_FILTER_LENGTH): string | undefined => {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new TypeError("invalid filter");
  for (const character of normalized) {
    const point = character.codePointAt(0);
    if (point !== undefined && (point < 32 || point === 127)) throw new TypeError("invalid filter");
  }
  return normalized;
};

const stateFilter = (value: string | null): AsyncJobState | undefined => {
  if (value === null) return undefined;
  if (
    value === "pending" || value === "running" || value === "retrying"
    || value === "completed" || value === "failed" || value === "dead_letter"
  ) return value;
  throw new TypeError("invalid state");
};

const limit = (value: string | null): number => {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d{1,2}$/u.test(value)) throw new TypeError("invalid limit");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) throw new TypeError("invalid limit");
  return parsed;
};

const toRecoverable = (row: JobRow): RecoverableJobRecord => ({
  jobId: row.job_id,
  type: row.job_type,
  idempotencyKey: row.idempotency_key,
  state: row.state,
  attempt: row.attempt,
  updatedAt: row.updated_at,
  ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
});

const loadJob = async (
  db: D1Database,
  environment: RuntimeEnvironment,
  jobId: string,
): Promise<JobRow | null> => db.prepare(`
  SELECT
    job_id, job_type, idempotency_key, state, attempt, requested_at, started_at, updated_at,
    completed_at, next_attempt_at, progress_percent, progress_code, failure_code
  FROM async_job_runs
  WHERE environment = ? AND job_id = ?
  LIMIT 1
`).bind(environment, jobId).first<JobRow>();

type JobAuthorizationResult =
  | { readonly ok: true; readonly actorId: string }
  | { readonly ok: false; readonly response: Response };

const authorize = async (
  request: Request,
  env: JobOperationsEnvironment,
  requestId: string,
  policy: RolePolicy,
  action: string,
  scopeId: string,
): Promise<JobAuthorizationResult> => {
  let authentication;
  try {
    authentication = await requireAuthenticatedUser(request, env.DB);
  } catch {
    return { ok: false, response: error(requestId, 503, "authentication_unavailable", "Authentication is unavailable") };
  }
  if (!authentication.allowed) {
    return { ok: false, response: error(requestId, authentication.status, authentication.code, authentication.message) };
  }
  try {
    const decision = await requireScopedAuthorization({
      db: env.DB,
      userId: authentication.user.id,
      policy,
      action,
      requestedScopeId: scopeId,
      resourceScopeId: scopeId,
    });
    if (!decision.allowed) {
      return { ok: false, response: error(requestId, decision.status, decision.code, decision.message) };
    }
    return { ok: true, actorId: authentication.user.id };
  } catch {
    return { ok: false, response: error(requestId, 503, "authorization_unavailable", "Authorization is unavailable") };
  }
};

const retryRequest = (
  environment: RuntimeEnvironment,
  job: RecoverableJobRecord,
  scopeId: string,
  requestId: string,
  reason?: string,
): OperationRequest => ({
  definition: JOB_RETRY_OPERATION,
  actorKind: "HUMAN",
  environment,
  target: { resourceType: "async_job", resourceId: job.jobId, scopeId },
  affectedCount: 1,
  ...(reason ? { reason } : {}),
  correlationId: requestId,
});

const retryRoute = (pathname: string): { jobId: string; preview: boolean } | null => {
  const match = pathname.match(/^\/api\/admin\/jobs\/([^/]+)\/retry(?:\/(preview))?$/u);
  if (!match) return null;
  try {
    const jobId = decodeURIComponent(match[1]).trim();
    if (!jobId || jobId.length > MAX_FILTER_LENGTH) return null;
    return { jobId, preview: match[2] === "preview" };
  } catch {
    return null;
  }
};

export const handleJobOperationsApi = async (
  request: Request,
  env: JobOperationsEnvironment,
  requestId: string,
  options: JobOperationsApiOptions = {},
): Promise<Response | null> => {
  const url = new URL(request.url);
  const retry = retryRoute(url.pathname);
  if (url.pathname !== "/api/admin/jobs" && !retry) return null;

  const environment = env.RUNTIME_ENVIRONMENT;
  if (!environment || !isRuntimeEnvironment(environment)) {
    return error(requestId, 503, "runtime_environment_required", "Runtime environment is unavailable");
  }

  const policy = options.authorizationPolicy ?? defaultAuthorizationPolicy;
  const recoveryRegistry = options.recoveryRegistry ?? new JobRecoveryRegistry();

  if (url.pathname === "/api/admin/jobs") {
    if (request.method !== "GET") {
      return error(requestId, 405, "method_not_allowed", "Method not allowed");
    }

    let scopeId: string;
    try {
      scopeId = bounded(url.searchParams.get("scopeId")) ?? "";
      if (!scopeId) throw new TypeError("scopeId required");
    } catch {
      return error(requestId, 400, "invalid_job_query", "Job query is invalid");
    }

    const auth = await authorize(request, env, requestId, policy, JOB_VIEW_ACTION, scopeId);
    if (!auth.ok) return auth.response;

    let state: AsyncJobState | undefined;
    let jobType: string | undefined;
    let pageSize: number;
    try {
      state = stateFilter(url.searchParams.get("state"));
      jobType = bounded(url.searchParams.get("type"));
      pageSize = limit(url.searchParams.get("limit"));
    } catch {
      return error(requestId, 400, "invalid_job_query", "Job query is invalid");
    }

    try {
      const where = ["environment = ?"];
      const values: (string | number)[] = [environment];
      if (state) {
        where.push("state = ?");
        values.push(state);
      }
      if (jobType) {
        where.push("job_type = ?");
        values.push(jobType);
      }
      values.push(pageSize);

      const result = await env.DB.prepare(`
        SELECT
          job_id, job_type, idempotency_key, state, attempt, requested_at, started_at, updated_at,
          completed_at, next_attempt_at, progress_percent, progress_code, failure_code
        FROM async_job_runs
        WHERE ${where.join(" AND ")}
        ORDER BY updated_at DESC, job_id DESC
        LIMIT ?
      `).bind(...values).all<JobRow>();

      return json({
        items: (result.results ?? []).map((row) => {
          const adapter = recoveryRegistry.get(row.job_type);
          const terminal = row.state === "failed" || row.state === "dead_letter";
          return {
            jobId: row.job_id,
            type: row.job_type,
            state: row.state,
            attempt: row.attempt,
            requestedAt: row.requested_at,
            startedAt: row.started_at,
            updatedAt: row.updated_at,
            completedAt: row.completed_at,
            nextAttemptAt: row.next_attempt_at,
            progress: row.progress_percent === null ? null : {
              percent: row.progress_percent,
              code: row.progress_code,
            },
            failureCode: row.failure_code,
            retry: {
              available: terminal && adapter !== null,
              reason: !terminal
                ? "job_not_terminal"
                : adapter === null
                  ? "recovery_adapter_not_registered"
                  : null,
            },
          };
        }),
        limit: pageSize,
      });
    } catch {
      return error(requestId, 503, "job_operations_unavailable", "Job operations are unavailable");
    }
  }

  if (!retry) return null;
  const scopeId = bounded(url.searchParams.get("scopeId")) ?? "";
  if (!scopeId) return error(requestId, 400, "invalid_job_query", "scopeId is required");

  if (retry.preview) {
    if (request.method !== "GET") return error(requestId, 405, "method_not_allowed", "Method not allowed");
  } else if (request.method !== "POST") {
    return error(requestId, 405, "method_not_allowed", "Method not allowed");
  }

  const auth = await authorize(request, env, requestId, policy, JOB_RETRY_ACTION, scopeId);
  if (!auth.ok) return auth.response;

  const row = await loadJob(env.DB, environment, retry.jobId);
  if (!row) return error(requestId, 404, "job_not_found", "Job was not found");
  const job = toRecoverable(row);
  if (job.state !== "failed" && job.state !== "dead_letter") {
    return error(requestId, 409, "job_not_retryable", "Job is not in a terminal failure state");
  }
  const adapter = recoveryRegistry.get(job.type);
  if (!adapter) {
    return error(requestId, 409, "job_retry_unavailable", "No safe recovery adapter is registered for this job type");
  }

  const service = new OperationsApplicationService(
    new OperationRegistry([createJobRetryOperationHandler({ environment, job, adapter })]),
    options.auditLogger ?? consoleAuditLogger,
  );

  if (retry.preview) {
    const operationRequest = retryRequest(environment, job, scopeId, requestId);
    const preview = service.preview({ allowed: true }, operationRequest);
    return json({ preview, policyVersion: OPERATIONS_POLICY_VERSION });
  }

  const csrf = await requireCsrfProtection(request);
  if (!csrf.allowed) return csrfGuardFailureResponse(csrf, requestId);

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    return apiErrorResponse(
      { status: bodyResult.status, code: bodyResult.code, message: bodyResult.message },
      requestId,
    );
  }
  const body = bodyResult.value as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const confirmed = body.confirmed === true;
  const previewPolicyVersion =
    typeof body.previewPolicyVersion === "string" ? body.previewPolicyVersion : "";
  if (!reason || reason.length > 200 || !confirmed || !previewPolicyVersion) {
    return error(requestId, 400, "invalid_retry_request", "Reason, confirmation, and preview policy version are required");
  }

  const operationRequest = retryRequest(environment, job, scopeId, requestId, reason);
  const preview = service.preview({ allowed: true }, operationRequest);
  const result = await service.execute(
    operationRequest,
    preview,
    {
      actorId: auth.actorId,
      requestContext: { requestId, method: request.method, path: url.pathname },
      previewPolicyVersion,
      evidence: { confirmed, reason },
      executionId: crypto.randomUUID(),
    },
  );
  return json(result, result.execution.result === "SUCCESS" ? 200 : 409);
};
