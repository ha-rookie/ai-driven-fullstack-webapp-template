import { findExampleResourceScopeId } from "../../infrastructure/d1-example-resource-scope";
import {
  createD1IdempotencyHttpStore,
  IdempotencyHttpGuard,
  idempotencyRejectionResponse,
  idempotencyReplayResponse,
} from "../http/idempotency";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import { consoleAuditLogger, type AuditLogger } from "../audit";
import {
  apiErrorResponse,
  csrfGuardFailureResponse,
  readJsonBody,
  requireCsrfProtection,
} from "../http";
import {
  OperationRegistry,
  OperationsApplicationService,
  OPERATIONS_POLICY_VERSION,
  type OperationRequest,
} from "../operations";
import {
  DataCorrectionRegistry,
  createDataCorrectionOperationHandler,
  type DataCorrectionExecutionResult,
} from "./data-correction";
import { createRestoreSoftDeletedExampleResourceAdapter } from "./example-resource-corrections";

const DEFAULT_POLICY: RolePolicy = {
  "data_correction:restore": ["system_admin"],
};

export interface DataCorrectionApiEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}

export interface DataCorrectionApiOptions {
  readonly authorizationPolicy?: RolePolicy;
  readonly registry?: DataCorrectionRegistry;
  readonly auditLogger?: AuditLogger;
}

interface CorrectionRoute {
  readonly commandKey: string;
  readonly phase: "preview" | "execute";
}

const error = (
  requestId: string,
  status: number,
  code: string,
  message: string,
): Response => apiErrorResponse({ status, code, message }, requestId);

const decode = (value: string): string | null => {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded && decoded.length <= 128 ? decoded : null;
  } catch {
    return null;
  }
};

const resolveRoute = (pathname: string): CorrectionRoute | null => {
  const match = pathname.match(
    /^\/api\/admin\/data-corrections\/([^/]+)\/(preview|execute)$/u,
  );
  if (!match) return null;
  const commandKey = decode(match[1]);
  if (!commandKey) return null;
  return { commandKey, phase: match[2] as "preview" | "execute" };
};

const positiveVersion = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const createDefaultRegistry = (db: D1Database): DataCorrectionRegistry =>
  new DataCorrectionRegistry([
    createRestoreSoftDeletedExampleResourceAdapter(db),
  ]);

export const handleDataCorrectionApi = async (
  request: Request,
  env: DataCorrectionApiEnvironment,
  requestId: string,
  options: DataCorrectionApiOptions = {},
): Promise<Response | null> => {
  const url = new URL(request.url);
  const route = resolveRoute(url.pathname);
  if (!route) return null;

  if (
    (route.phase === "preview" && request.method !== "GET")
    || (route.phase === "execute" && request.method !== "POST")
  ) {
    return error(requestId, 405, "method_not_allowed", "Method not allowed");
  }

  const environment = env.RUNTIME_ENVIRONMENT;
  if (environment !== "local" && environment !== "test" && environment !== "preview" && environment !== "production") {
    return error(requestId, 503, "runtime_environment_required", "Runtime environment is unavailable");
  }

  const scopeId = decode(url.searchParams.get("scopeId") ?? "");
  const resourceId = decode(url.searchParams.get("resourceId") ?? "");
  const expectedVersionFromQuery = positiveVersion(url.searchParams.get("expectedVersion"));
  if (!scopeId || !resourceId) {
    return error(requestId, 400, "invalid_correction_request", "scopeId and resourceId are required");
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
  const actorId = authentication.user.id;

  const registry = options.registry ?? createDefaultRegistry(env.DB);
  const adapter = registry.get(route.commandKey);
  if (!adapter) {
    return error(requestId, 404, "correction_command_not_found", "Correction command was not found");
  }

  let resourceScopeId: string | null;
  try {
    resourceScopeId = await findExampleResourceScopeId(env.DB, resourceId);
  } catch {
    return error(requestId, 503, "correction_dependency_unavailable", "Correction dependency is unavailable");
  }
  if (!resourceScopeId) {
    return error(requestId, 404, "correction_target_not_found", "Correction target was not found");
  }

  let authorization;
  try {
    authorization = await requireScopedAuthorization({
      db: env.DB,
      userId: actorId,
      policy: options.authorizationPolicy ?? DEFAULT_POLICY,
      action: adapter.definition.capability,
      requestedScopeId: scopeId,
      resourceScopeId,
    });
  } catch {
    return error(requestId, 503, "authorization_unavailable", "Authorization is unavailable");
  }
  if (!authorization.allowed) {
    return error(requestId, authorization.status, authorization.code, authorization.message);
  }

  if (route.phase === "preview") {
    if (!expectedVersionFromQuery) {
      return error(requestId, 400, "expected_version_required", "expectedVersion is required");
    }

    const handler = createDataCorrectionOperationHandler({
      adapter,
      actorId,
      expectedVersion: expectedVersionFromQuery,
    });
    const service = new OperationsApplicationService(
      new OperationRegistry([handler]),
      options.auditLogger ?? consoleAuditLogger,
    );
    const operationRequest: OperationRequest = {
      definition: handler.definition,
      actorKind: "HUMAN",
      environment,
      target: { resourceType: "example_resource", resourceId, scopeId },
      affectedCount: 1,
      expectedVersion: expectedVersionFromQuery,
      correlationId: requestId,
    };
    const preview = service.preview({ allowed: true }, operationRequest);
    const correctionPreview = adapter.inspect
      ? await adapter.inspect({
          targetId: resourceId,
          expectedVersion: expectedVersionFromQuery,
        })
      : { available: true };
    return Response.json(
      {
        command: {
          key: adapter.definition.key,
          version: adapter.definition.version,
          capability: adapter.definition.capability,
          supportsPreview: adapter.definition.supportsPreview,
        },
        correctionPreview,
        preview,
        policyVersion: OPERATIONS_POLICY_VERSION,
      },
      { headers: { "cache-control": "no-store" } },
    );
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
  const body = asObject(bodyResult.value);
  const expectedVersion = positiveVersion(body?.expectedVersion);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const confirmed = body?.confirmed === true;
  const previewPolicyVersion =
    typeof body?.previewPolicyVersion === "string" ? body.previewPolicyVersion : "";

  if (
    !expectedVersion
    || !reason
    || reason.length > 200
    || !confirmed
    || !previewPolicyVersion
  ) {
    return error(
      requestId,
      400,
      "invalid_correction_request",
      "expectedVersion, reason, confirmation, and preview policy version are required",
    );
  }

  const idempotency = new IdempotencyHttpGuard(createD1IdempotencyHttpStore(env.DB));
  const idempotencyDecision = await idempotency.begin({
    request,
    actorId,
    scopeId,
    action: `data_correction:${route.commandKey}`,
  });
  if (idempotencyDecision.kind === "reject") {
    return idempotencyRejectionResponse(idempotencyDecision, requestId);
  }
  if (idempotencyDecision.kind === "replay") {
    return idempotencyReplayResponse(idempotencyDecision, requestId);
  }

  let correctionResult: DataCorrectionExecutionResult | undefined;
  const handler = createDataCorrectionOperationHandler({
    adapter,
    actorId,
    expectedVersion,
    onResult: (result) => {
      correctionResult = result;
    },
  });
  const service = new OperationsApplicationService(
    new OperationRegistry([handler]),
    options.auditLogger ?? consoleAuditLogger,
  );
  const operationRequest: OperationRequest = {
    definition: handler.definition,
    actorKind: "HUMAN",
    environment,
    target: { resourceType: "example_resource", resourceId, scopeId },
    affectedCount: 1,
    expectedVersion,
    reason,
    correlationId: requestId,
  };
  const preview = service.preview({ allowed: true }, operationRequest);

  const result = await service.execute(
    operationRequest,
    preview,
    {
      actorId,
      requestContext: { requestId, method: request.method, path: url.pathname },
      previewPolicyVersion,
      evidence: { confirmed, reason },
      executionId: crypto.randomUUID(),
    },
  );

  const status = result.execution.result === "SUCCESS"
    ? 200
    : result.execution.result === "CONFLICT" || result.execution.result === "REJECTED"
      ? 409
      : 503;
  const response = Response.json(
    {
      ...result,
      correction: correctionResult ?? null,
    },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );

  if (status === 200) {
    await idempotency.completeWithResponse(idempotencyDecision.execution, response.clone());
  } else {
    await idempotency.fail(idempotencyDecision.execution);
  }
  return response;
};
