import type { ExampleResourceStatus } from "../domain/example-resource";
import { findExampleResourceScopeId } from "../infrastructure/d1-example-resource-scope";
import {
  loadExampleResource,
  renameExampleResource,
  transitionExampleResourceStatus,
  type IntegrityMutationResult,
} from "../infrastructure/d1-example-resource-store";
import {
  requireAuthenticatedUser,
  requireScopedAuthorization,
  type RolePolicy,
} from "./authorization";
import type { SessionPolicy } from "./auth";
import type { AuditEvent } from "./audit";
import {
  apiErrorResponse,
  csrfGuardFailureResponse,
  formatVersionEtag,
  readJsonBody,
  requireCsrfProtection,
  resolveConcurrencyPrecondition,
  stalePreconditionHttpMapping,
  type ConcurrencyPrecondition,
  type RequestBodyFailure,
} from "./http";

type RequestAuditFields = Omit<AuditEvent, "requestId" | "method" | "path">;
type Audit = (event: RequestAuditFields) => void;

const exampleResourcePolicy: RolePolicy = {
  "example_resource:read": ["viewer", "editor"],
  "example_resource:write": ["editor"],
};

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
};

const versionedJson = (body: unknown, version: number): Response =>
  json(body, {
    headers: { etag: formatVersionEtag(version) },
  });

const error = (
  requestId: string,
  code: string,
  message: string,
  status: number,
  extra?: Readonly<Record<string, unknown>>,
) => apiErrorResponse({ code, message, status, extra }, requestId);

const asJsonObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const requestBodyFailureResponse = (
  result: RequestBodyFailure,
  requestId: string,
): Response =>
  apiErrorResponse(
    {
      status: result.status,
      code: result.code,
      message: result.message,
    },
    requestId,
  );

const isExampleStatus = (value: unknown): value is ExampleResourceStatus =>
  value === "draft" || value === "active" || value === "finalized";

const decodePathPart = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const integrityFailureResponse = (
  result: Exclude<IntegrityMutationResult, { ok: true }>,
  requestId: string,
  precondition: ConcurrencyPrecondition,
): Response => {
  const current = result.current
    ? {
        current: {
          version: result.current.version,
          status: result.current.status,
        },
      }
    : undefined;

  switch (result.reason) {
    case "not_found":
      return error(requestId, "resource_not_found", "Resource not found", 404);
    case "stale": {
      const mapping = stalePreconditionHttpMapping(precondition);
      return error(
        requestId,
        mapping.code,
        mapping.message,
        mapping.status,
        current,
      );
    }
    case "immutable":
      return error(
        requestId,
        "resource_immutable",
        "The resource can no longer be changed",
        409,
        current,
      );
    case "state_changed":
      return error(
        requestId,
        "state_changed",
        "The resource state no longer matches the request",
        409,
        current,
      );
    case "invalid_transition":
      return error(
        requestId,
        "invalid_transition",
        "The requested state transition is not allowed",
        409,
      );
  }
};

const auditMutationFailure = (
  audit: Audit,
  actorId: string,
  scopeId: string,
  resourceId: string,
  action: string,
  reason: string,
) =>
  audit({
    category: "mutation",
    action,
    outcome: "failure",
    actorId,
    scopeId,
    resourceType: "example_resource",
    resourceId,
    reason,
  });

const preconditionFailureResponse = (
  result: Exclude<ReturnType<typeof resolveConcurrencyPrecondition>, { ok: true }>,
  requestId: string,
): Response =>
  apiErrorResponse(
    {
      status: result.status,
      code: result.code,
      message: result.message,
    },
    requestId,
  );

export const handleExampleResourceApi = async (
  request: Request,
  db: D1Database,
  audit: Audit,
  requestId: string,
  sessionPolicy?: SessionPolicy,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const statusMatch = url.pathname.match(
    /^\/api\/scopes\/([^/]+)\/example-resources\/([^/]+)\/status$/,
  );
  const resourceMatch = url.pathname.match(
    /^\/api\/scopes\/([^/]+)\/example-resources\/([^/]+)$/,
  );
  const match = statusMatch ?? resourceMatch;

  if (!match) return null;

  const scopeId = decodePathPart(match[1]);
  const resourceId = decodePathPart(match[2]);
  if (!scopeId || !resourceId) {
    return error(requestId, "invalid_path", "Resource path is invalid", 400);
  }

  const isStatusRoute = Boolean(statusMatch);
  const allowedMethod = isStatusRoute
    ? request.method === "POST"
    : request.method === "GET" || request.method === "PATCH";
  if (!allowedMethod) {
    return error(requestId, "method_not_allowed", "Method not allowed", 405);
  }

  let authentication;
  try {
    authentication = await requireAuthenticatedUser(request, db, sessionPolicy);
  } catch {
    audit({
      category: "authentication",
      action: "protected_resource_session_resolve",
      outcome: "failure",
      scopeId,
      resourceType: "example_resource",
      resourceId,
      reason: "dependency_error",
    });
    return error(
      requestId,
      "authentication_unavailable",
      "Authentication is unavailable",
      503,
    );
  }

  if (!authentication.allowed) {
    audit({
      category: "authentication",
      action: "protected_resource_session_resolve",
      outcome: "failure",
      scopeId,
      resourceType: "example_resource",
      resourceId,
      reason: authentication.reason,
    });
    return apiErrorResponse(
      {
        status: authentication.status,
        code: authentication.code,
        message: authentication.message,
      },
      requestId,
    );
  }

  const actorId = authentication.user.id;

  if (request.method !== "GET") {
    const csrf = await requireCsrfProtection(request);
    if (!csrf.allowed) {
      audit({
        category: "authentication",
        action: "csrf_guard",
        outcome: "failure",
        actorId,
        scopeId,
        resourceType: "example_resource",
        resourceId,
        reason: csrf.reason,
      });
      return csrfGuardFailureResponse(csrf, requestId);
    }
  }

  let resource;
  let resourceScopeId;
  try {
    resource = await loadExampleResource(db, resourceId);
    resourceScopeId = await findExampleResourceScopeId(db, resourceId);
  } catch {
    audit({
      category: "system",
      action: "protected_resource_dependency",
      outcome: "failure",
      actorId,
      scopeId,
      resourceType: "example_resource",
      resourceId,
      reason: "dependency_error",
    });
    return error(requestId, "resource_unavailable", "Resource is unavailable", 503);
  }

  if (!resource || !resourceScopeId) {
    return error(requestId, "resource_not_found", "Resource not found", 404);
  }

  const authorizationAction =
    request.method === "GET"
      ? "example_resource:read"
      : "example_resource:write";

  let authorization;
  try {
    authorization = await requireScopedAuthorization({
      db,
      userId: actorId,
      policy: exampleResourcePolicy,
      action: authorizationAction,
      requestedScopeId: scopeId,
      resourceScopeId,
    });
  } catch {
    audit({
      category: "system",
      action: "protected_resource_dependency",
      outcome: "failure",
      actorId,
      scopeId,
      resourceType: "example_resource",
      resourceId,
      reason: "dependency_error",
    });
    return error(requestId, "resource_unavailable", "Resource is unavailable", 503);
  }

  if (!authorization.allowed) {
    audit({
      category: "authorization",
      action: authorizationAction,
      outcome: "failure",
      actorId,
      scopeId,
      resourceType: "example_resource",
      resourceId,
      reason: authorization.reason,
    });
    return apiErrorResponse(
      {
        status: authorization.status,
        code: authorization.code,
        message: authorization.message,
      },
      requestId,
    );
  }

  if (request.method === "GET") {
    return versionedJson({ resource }, resource.version);
  }

  if (request.method === "PATCH" && !isStatusRoute) {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) {
      auditMutationFailure(
        audit,
        actorId,
        scopeId,
        resourceId,
        "example_resource.rename",
        bodyResult.code,
      );
      return requestBodyFailureResponse(bodyResult, requestId);
    }

    const body = asJsonObject(bodyResult.value);
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (!name || name.length > 120) {
      auditMutationFailure(
        audit,
        actorId,
        scopeId,
        resourceId,
        "example_resource.rename",
        "invalid_request",
      );
      return error(
        requestId,
        "invalid_request",
        "name is required and must be at most 120 characters",
        400,
      );
    }

    const preconditionResult = resolveConcurrencyPrecondition(
      request,
      body?.expectedVersion,
    );
    if (!preconditionResult.ok) {
      auditMutationFailure(
        audit,
        actorId,
        scopeId,
        resourceId,
        "example_resource.rename",
        preconditionResult.reason,
      );
      return preconditionFailureResponse(preconditionResult, requestId);
    }

    const precondition = preconditionResult.precondition;

    try {
      const result = await renameExampleResource(db, {
        id: resourceId,
        name,
        expectedVersion: precondition.expectedVersion,
        changedAt: new Date().toISOString(),
      });

      if (!result.ok) {
        auditMutationFailure(
          audit,
          actorId,
          scopeId,
          resourceId,
          "example_resource.rename",
          result.reason,
        );
        return integrityFailureResponse(result, requestId, precondition);
      }

      audit({
        category: "mutation",
        action: "example_resource.rename",
        outcome: "success",
        actorId,
        scopeId,
        resourceType: "example_resource",
        resourceId,
      });
      return versionedJson({ resource: result.resource }, result.resource.version);
    } catch {
      auditMutationFailure(
        audit,
        actorId,
        scopeId,
        resourceId,
        "example_resource.rename",
        "dependency_error",
      );
      return error(requestId, "mutation_unavailable", "Mutation is unavailable", 503);
    }
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    auditMutationFailure(
      audit,
      actorId,
      scopeId,
      resourceId,
      "example_resource.transition",
      bodyResult.code,
    );
    return requestBodyFailureResponse(bodyResult, requestId);
  }

  const body = asJsonObject(bodyResult.value);
  const fromStatus = body?.fromStatus;
  const toStatus = body?.toStatus;

  if (!isExampleStatus(fromStatus) || !isExampleStatus(toStatus)) {
    auditMutationFailure(
      audit,
      actorId,
      scopeId,
      resourceId,
      "example_resource.transition",
      "invalid_request",
    );
    return error(
      requestId,
      "invalid_request",
      "fromStatus and toStatus are required",
      400,
    );
  }

  const preconditionResult = resolveConcurrencyPrecondition(
    request,
    body?.expectedVersion,
  );
  if (!preconditionResult.ok) {
    auditMutationFailure(
      audit,
      actorId,
      scopeId,
      resourceId,
      "example_resource.transition",
      preconditionResult.reason,
    );
    return preconditionFailureResponse(preconditionResult, requestId);
  }

  const precondition = preconditionResult.precondition;

  try {
    const result = await transitionExampleResourceStatus(db, {
      id: resourceId,
      fromStatus,
      toStatus,
      expectedVersion: precondition.expectedVersion,
      changedAt: new Date().toISOString(),
    });

    if (!result.ok) {
      auditMutationFailure(
        audit,
        actorId,
        scopeId,
        resourceId,
        "example_resource.transition",
        result.reason,
      );
      return integrityFailureResponse(result, requestId, precondition);
    }

    audit({
      category: "mutation",
      action: "example_resource.transition",
      outcome: "success",
      actorId,
      scopeId,
      resourceType: "example_resource",
      resourceId,
    });
    return versionedJson({ resource: result.resource }, result.resource.version);
  } catch {
    auditMutationFailure(
      audit,
      actorId,
      scopeId,
      resourceId,
      "example_resource.transition",
      "dependency_error",
    );
    return error(requestId, "mutation_unavailable", "Mutation is unavailable", 503);
  }
};
