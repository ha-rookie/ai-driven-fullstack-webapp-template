import type { ExampleResourceStatus } from "../domain/example-resource";
import { findExampleResourceScopeId } from "../infrastructure/d1-example-resource-scope";
import {
  loadExampleResource,
  renameExampleResource,
  transitionExampleResourceStatus,
  type IntegrityMutationResult,
} from "../infrastructure/d1-example-resource-store";
import {
  authorizationGuardFailureResponse,
  requireAuthenticatedUser,
  requireScopedAuthorization,
  type RolePolicy,
} from "./authorization";
import type { AuditEvent } from "./audit";

type RequestAuditFields = Omit<AuditEvent, "requestId" | "method" | "path">;
type Audit = (event: RequestAuditFields) => void;

const exampleResourcePolicy: RolePolicy = {
  "example_resource:read": ["viewer", "editor"],
  "example_resource:write": ["editor"],
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });

const error = (
  code: string,
  message: string,
  status: number,
  extra?: Readonly<Record<string, unknown>>,
) =>
  json(
    {
      error: { code, message },
      ...extra,
    },
    { status },
  );

const parseJsonObject = async (
  request: Request,
): Promise<Record<string, unknown> | null> => {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const isPositiveVersion = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1;

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
      return error("resource_not_found", "Resource not found", 404);
    case "stale":
      return error(
        "stale_update",
        "The resource changed after it was read",
        409,
        current,
      );
    case "immutable":
      return error(
        "resource_immutable",
        "The resource can no longer be changed",
        409,
        current,
      );
    case "state_changed":
      return error(
        "state_changed",
        "The resource state no longer matches the request",
        409,
        current,
      );
    case "invalid_transition":
      return error(
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

export const handleExampleResourceApi = async (
  request: Request,
  db: D1Database,
  audit: Audit,
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
    return error("invalid_path", "Resource path is invalid", 400);
  }

  const isStatusRoute = Boolean(statusMatch);
  const allowedMethod = isStatusRoute
    ? request.method === "POST"
    : request.method === "GET" || request.method === "PATCH";
  if (!allowedMethod) {
    return error("method_not_allowed", "Method not allowed", 405);
  }

  let authentication;
  try {
    authentication = await requireAuthenticatedUser(request, db);
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
    return authorizationGuardFailureResponse(authentication);
  }

  const actorId = authentication.user.id;

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
    return error("resource_unavailable", "Resource is unavailable", 503);
  }

  if (!resource || !resourceScopeId) {
    return error("resource_not_found", "Resource not found", 404);
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
    return error("resource_unavailable", "Resource is unavailable", 503);
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
    return authorizationGuardFailureResponse(authorization);
  }

  if (request.method === "GET") {
    return json({ resource });
  }

  if (request.method === "PATCH" && !isStatusRoute) {
    const body = await parseJsonObject(request);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const expectedVersion = body?.expectedVersion;

    if (
      !name ||
      name.length > 120 ||
      !isPositiveVersion(expectedVersion)
    ) {
      auditMutationFailure(
        audit,
        actorId,
        scopeId,
        resourceId,
        "example_resource.rename",
        "invalid_request",
      );
      return error(
        "invalid_request",
        "name and a positive expectedVersion are required",
        400,
      );
    }

    try {
      const result = await renameExampleResource(db, {
        id: resourceId,
        name,
        expectedVersion,
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
        return integrityFailureResponse(result);
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
      return json({ resource: result.resource });
    } catch {
      auditMutationFailure(
        audit,
        actorId,
        scopeId,
        resourceId,
        "example_resource.rename",
        "dependency_error",
      );
      return error("mutation_unavailable", "Mutation is unavailable", 503);
    }
  }

  const body = await parseJsonObject(request);
  const fromStatus = body?.fromStatus;
  const toStatus = body?.toStatus;
  const expectedVersion = body?.expectedVersion;

  if (
    !isExampleStatus(fromStatus) ||
    !isExampleStatus(toStatus) ||
    !isPositiveVersion(expectedVersion)
  ) {
    auditMutationFailure(
      audit,
      actorId,
      scopeId,
      resourceId,
      "example_resource.transition",
      "invalid_request",
    );
    return error(
      "invalid_request",
      "fromStatus, toStatus, and a positive expectedVersion are required",
      400,
    );
  }

  try {
    const result = await transitionExampleResourceStatus(db, {
      id: resourceId,
      fromStatus,
      toStatus,
      expectedVersion,
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
      return integrityFailureResponse(result);
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
    return json({ resource: result.resource });
  } catch {
    auditMutationFailure(
      audit,
      actorId,
      scopeId,
      resourceId,
      "example_resource.transition",
      "dependency_error",
    );
    return error("mutation_unavailable", "Mutation is unavailable", 503);
  }
};
