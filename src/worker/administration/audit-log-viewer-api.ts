import { isRuntimeEnvironment } from "../../shared/runtime";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import {
  D1DurableAuditStore,
  DurableAuditIntegrityError,
  type AuditSearchCursor,
  type AuditSearchQuery,
} from "../audit";
import { apiErrorResponse } from "../http";

const AUDIT_VIEW_ACTION = "audit:view";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_FILTER_LENGTH = 256;

export interface AuditLogViewerEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}

export interface AuditLogViewerOptions {
  readonly authorizationPolicy?: RolePolicy;
}

const defaultAuthorizationPolicy: RolePolicy = {
  [AUDIT_VIEW_ACTION]: ["system_admin"],
};

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });

const error = (
  requestId: string,
  status: number,
  code: string,
  message: string,
): Response => apiErrorResponse({ status, code, message }, requestId);

const bounded = (value: string | null): string | undefined => {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_FILTER_LENGTH) {
    throw new TypeError("Invalid bounded filter");
  }
  for (const character of normalized) {
    const point = character.codePointAt(0);
    if (point !== undefined && (point < 32 || point === 127)) {
      throw new TypeError("Invalid bounded filter");
    }
  }
  return normalized;
};

const category = (value: string | null): AuditSearchQuery["category"] => {
  if (value === null) return undefined;
  if (
    value === "authentication"
    || value === "authorization"
    || value === "mutation"
    || value === "system"
  ) return value;
  throw new TypeError("Invalid category");
};

const outcome = (value: string | null): AuditSearchQuery["outcome"] => {
  if (value === null) return undefined;
  if (value === "success" || value === "failure") return value;
  throw new TypeError("Invalid outcome");
};

const limit = (value: string | null): number => {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d{1,3}$/u.test(value)) throw new TypeError("Invalid limit");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new TypeError("Invalid limit");
  }
  return parsed;
};

const encodeCursor = (cursor: AuditSearchCursor | null): string | null => {
  if (!cursor) return null;
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const decodeCursor = (value: string | null): AuditSearchCursor | undefined => {
  if (value === null) return undefined;
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) throw new TypeError("Invalid cursor");
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as Partial<AuditSearchCursor>;
    if (
      typeof decoded.occurredAt !== "string"
      || typeof decoded.id !== "string"
      || decoded.id.length === 0
      || decoded.id.length > MAX_FILTER_LENGTH
    ) {
      throw new TypeError("Invalid cursor");
    }
    return { occurredAt: decoded.occurredAt, id: decoded.id };
  } catch {
    throw new TypeError("Invalid cursor");
  }
};

export const handleAuditLogViewerApi = async (
  request: Request,
  env: AuditLogViewerEnvironment,
  requestId: string,
  options: AuditLogViewerOptions = {},
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/audit") return null;
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
  let query: AuditSearchQuery;
  try {
    scopeId = bounded(url.searchParams.get("scopeId")) ?? "";
    if (!scopeId) throw new TypeError("scopeId required");
    query = {
      startAt: bounded(url.searchParams.get("startAt")),
      endAt: bounded(url.searchParams.get("endAt")),
      category: category(url.searchParams.get("category")),
      outcome: outcome(url.searchParams.get("outcome")),
      action: bounded(url.searchParams.get("action")),
      actorId: bounded(url.searchParams.get("actorId")),
      scopeId,
      resourceType: bounded(url.searchParams.get("resourceType")),
      resourceId: bounded(url.searchParams.get("resourceId")),
      cursor: decodeCursor(url.searchParams.get("cursor")),
      limit: limit(url.searchParams.get("limit")),
    };
  } catch {
    return error(requestId, 400, "invalid_audit_query", "Audit query is invalid");
  }

  try {
    const authorization = await requireScopedAuthorization({
      db: env.DB,
      userId: authentication.user.id,
      policy: options.authorizationPolicy ?? defaultAuthorizationPolicy,
      action: AUDIT_VIEW_ACTION,
      requestedScopeId: scopeId,
      resourceScopeId: scopeId,
    });
    if (!authorization.allowed) {
      return error(requestId, authorization.status, authorization.code, authorization.message);
    }

    const result = await new D1DurableAuditStore({
      db: env.DB,
      environment,
    }).search(query);

    return json({
      items: result.items.map((item) => ({
        id: item.id,
        environment: item.environment,
        timestamp: item.record.timestamp,
        requestId: item.record.requestId,
        category: item.record.category,
        action: item.record.action,
        outcome: item.record.outcome,
        actorId: item.record.actorId ?? null,
        scopeId: item.record.scopeId ?? null,
        resourceType: item.record.resourceType ?? null,
        resourceId: item.record.resourceId ?? null,
        reason: item.record.reason ?? null,
      })),
      nextCursor: encodeCursor(result.nextCursor),
    });
  } catch (caught) {
    if (caught instanceof DurableAuditIntegrityError) {
      return error(requestId, 409, "audit_integrity_error", "Audit record integrity verification failed");
    }
    if (caught instanceof TypeError || caught instanceof RangeError) {
      return error(requestId, 400, "invalid_audit_query", "Audit query is invalid");
    }
    return error(requestId, 503, "audit_unavailable", "Audit log is unavailable");
  }
};
