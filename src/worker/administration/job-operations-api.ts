import { isRuntimeEnvironment } from "../../shared/runtime";
import type { AsyncJobState } from "../../shared/async-job";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import { apiErrorResponse } from "../http";

const JOB_VIEW_ACTION = "jobs:view";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_FILTER_LENGTH = 128;

const defaultAuthorizationPolicy: RolePolicy = {
  [JOB_VIEW_ACTION]: ["system_admin"],
};

export interface JobOperationsEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}

interface JobRow {
  readonly job_id: string;
  readonly job_type: string;
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

const bounded = (value: string | null): string | undefined => {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_FILTER_LENGTH) throw new TypeError("invalid filter");
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

export const handleJobOperationsApi = async (
  request: Request,
  env: JobOperationsEnvironment,
  requestId: string,
  options: { readonly authorizationPolicy?: RolePolicy } = {},
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/jobs") return null;
  if (request.method !== "GET") {
    return error(requestId, 405, "method_not_allowed", "Method not allowed");
  }

  const environment = env.RUNTIME_ENVIRONMENT;
  if (!environment || !isRuntimeEnvironment(environment)) {
    return error(requestId, 503, "runtime_environment_required", "Runtime environment is unavailable");
  }

  let authentication;
  try {
    authentication = await requireAuthenticatedUser(request, env.DB);
  } catch {
    return error(requestId, 503, "authentication_unavailable", "Authentication is unavailable");
  }
  if (!authentication.allowed) {
    return error(requestId, authentication.status, authentication.code, authentication.message);
  }

  let scopeId: string;
  let state: AsyncJobState | undefined;
  let jobType: string | undefined;
  let pageSize: number;
  try {
    scopeId = bounded(url.searchParams.get("scopeId")) ?? "";
    if (!scopeId) throw new TypeError("scopeId required");
    state = stateFilter(url.searchParams.get("state"));
    jobType = bounded(url.searchParams.get("type"));
    pageSize = limit(url.searchParams.get("limit"));
  } catch {
    return error(requestId, 400, "invalid_job_query", "Job query is invalid");
  }

  try {
    const authorization = await requireScopedAuthorization({
      db: env.DB,
      userId: authentication.user.id,
      policy: options.authorizationPolicy ?? defaultAuthorizationPolicy,
      action: JOB_VIEW_ACTION,
      requestedScopeId: scopeId,
      resourceScopeId: scopeId,
    });
    if (!authorization.allowed) {
      return error(requestId, authorization.status, authorization.code, authorization.message);
    }

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
        job_id, job_type, state, attempt, requested_at, started_at, updated_at,
        completed_at, next_attempt_at, progress_percent, progress_code, failure_code
      FROM async_job_runs
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC, job_id DESC
      LIMIT ?
    `).bind(...values).all<JobRow>();

    return json({
      items: (result.results ?? []).map((row) => ({
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
          available: false,
          reason:
            row.state === "failed" || row.state === "dead_letter"
              ? "recovery_adapter_not_registered"
              : "job_not_terminal",
        },
      })),
      limit: pageSize,
    });
  } catch {
    return error(requestId, 503, "job_operations_unavailable", "Job operations are unavailable");
  }
};
