import { D1OperationModeStore } from "../../infrastructure/d1-operation-mode-store";
import { isRuntimeEnvironment } from "../../shared/runtime";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import { consoleAuditLogger, type AuditLogger } from "../audit";
import {
  apiErrorResponse, csrfGuardFailureResponse, readJsonBody, requireCsrfProtection,
  OperationModeGuard, operationModeRejectionResponse,
} from "../http";
import {
  createD1IdempotencyHttpStore, IdempotencyHttpGuard,
  idempotencyRejectionResponse, idempotencyReplayResponse,
} from "../http/idempotency";
import { D1MasterDataStore, MasterDataError, MasterDataService, StaticMasterDefinitionRegistry, type MasterDefinition } from "../master-data";
import {
  OperationRegistry, OperationsApplicationService, OPERATIONS_POLICY_VERSION,
  type OperationDefinition, type OperationHandler, type OperationRequest,
} from "../operations";

export const RETIRE_MASTER_ITEM = "RETIRE_MASTER_ITEM";
const ACTION = "master_data:retire";
const OPERATION: OperationDefinition = Object.freeze({
  id: RETIRE_MASTER_ITEM, capability: ACTION, baseRisk: "CONTROLLED_CHANGE",
  reversible: false, idempotent: false, externalSideEffect: false, requiresVerification: true,
});
const defaultPolicy: RolePolicy = { [ACTION]: ["system_admin"] };

export interface MasterRetireEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}
export interface MasterRetireOptions {
  readonly scopeId: string;
  readonly definition: MasterDefinition;
  /** Reference-specific explicit allowlist. Never infer allowed IDs from request parameters. */
  readonly allowedItemIds: readonly string[];
  readonly authorizationPolicy?: RolePolicy;
  readonly auditLogger?: AuditLogger;
}
interface MasterItemProjection {
  readonly id: string;
  readonly code: string;
  readonly masterKey: string;
  readonly version: number;
  readonly retiredAt: string | null;
}
const error = (requestId: string, status: number, code: string, message: string): Response =>
  apiErrorResponse({ status, code, message }, requestId);
const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const positiveVersion = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
const fromQueryVersion = (value: string | null): number | null =>
  value !== null && /^[1-9][0-9]{0,12}$/u.test(value) ? positiveVersion(Number(value)) : null;
const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

export const createRetireMasterHandler = (input: {
  readonly db: D1Database;
  readonly environment: string;
  readonly definition: MasterDefinition;
  readonly actorId: string;
  readonly expectedVersion: number;
}): OperationHandler => {
  const store = new D1MasterDataStore(input.db);
  const service = new MasterDataService({
    environment: input.environment,
    store,
    definitions: new StaticMasterDefinitionRegistry([input.definition]),
  });
  return {
    definition: OPERATION,
    async execute(request) {
      if (
        request.definition.id !== RETIRE_MASTER_ITEM
        || request.expectedVersion !== input.expectedVersion
        || !request.reason?.trim()
      ) return { result: "CONFLICT" };
      const current = await store.getItem(request.target.resourceId, input.environment);
      if (!current || current.masterKey !== input.definition.key) return { result: "CONFLICT" };
      try {
        await service.retireItem({
          itemId: current.id, actorId: input.actorId,
          expectedItemVersion: input.expectedVersion,
        });
        return { result: "SUCCESS" };
      } catch (caught) {
        if (caught instanceof MasterDataError &&
          (caught.code === "conflict" || caught.code === "retired" || caught.code === "not_found")) {
          return { result: "CONFLICT" };
        }
        throw caught;
      }
    },
    async verify(request, execution) {
      if (execution.result !== "SUCCESS") return { status: "NOT_APPLICABLE" };
      const item = await store.getItem(request.target.resourceId, input.environment);
      return item?.version === input.expectedVersion + 1 && item.retiredAt !== null
        && item.masterKey === input.definition.key && item.updatedBy === input.actorId
        ? { status: "PASSED", summary: "Master is retired at the expected post-operation version" }
        : { status: "FAILED", summary: "Master post-retirement state differs from expected" };
    },
  };
};

const project = (item: Awaited<ReturnType<D1MasterDataStore["getItem"]>>): MasterItemProjection | null =>
  item ? { id: item.id, code: item.code, masterKey: item.masterKey, version: item.version, retiredAt: item.retiredAt } : null;

/** Preview-only reference command. This endpoint intentionally is not a generic Master CRUD API. */
export const handleMasterRetireApi = async (
  request: Request,
  env: MasterRetireEnvironment,
  requestId: string,
  options: MasterRetireOptions,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const previewPath = "/api/admin/master-operations/retire/preview";
  const executePath = "/api/admin/master-operations/retire/execute";
  if (url.pathname !== previewPath && url.pathname !== executePath) return null;
  const isPreview = url.pathname === previewPath;
  if (request.method !== (isPreview ? "GET" : "POST")) {
    return error(requestId, 405, "method_not_allowed", "Method not allowed");
  }
  const environment = env.RUNTIME_ENVIRONMENT;
  if (!environment || !isRuntimeEnvironment(environment)) {
    return error(requestId, 503, "runtime_environment_required", "Runtime environment is unavailable");
  }
  // A demo-only mutation must never be exposed in Production, independently of policy.
  if (environment === "production") {
    return error(requestId, 403, "human_gate_required", "Production master retirement requires human approval");
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
  const scopeId = url.searchParams.get("scopeId");
  const itemId = url.searchParams.get("itemId");
  if (scopeId !== options.scopeId || !itemId || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(itemId)) {
    return error(requestId, 403, "forbidden", "Access denied");
  }
  try {
    const decision = await requireScopedAuthorization({
      db: env.DB, userId: actorId, policy: options.authorizationPolicy ?? defaultPolicy,
      action: ACTION, requestedScopeId: scopeId, resourceScopeId: options.scopeId,
    });
    if (!decision.allowed) return error(requestId, decision.status, decision.code, decision.message);
  } catch {
    return error(requestId, 503, "authorization_unavailable", "Authorization is unavailable");
  }
  if (!options.allowedItemIds.includes(itemId)) {
    return error(requestId, 404, "master_operation_not_available", "Master operation is not available");
  }

  const store = new D1MasterDataStore(env.DB);
  let before: MasterItemProjection | null;
  try {
    before = project(await store.getItem(itemId, environment));
  } catch {
    return error(requestId, 503, "master_data_unavailable", "Master data is unavailable");
  }
  if (!before || before.masterKey !== options.definition.key) {
    return error(requestId, 404, "master_item_not_found", "Master item was not found");
  }

  let expectedVersion: number | null = isPreview
    ? fromQueryVersion(url.searchParams.get("expectedVersion"))
    : null;
  let reason = "";
  let confirmed = false;
  let policyVersion = "";
  if (!isPreview) {
    const csrf = await requireCsrfProtection(request);
    if (!csrf.allowed) return csrfGuardFailureResponse(csrf, requestId);
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(requestId, parsed.status, parsed.code, parsed.message);
    const body = asObject(parsed.value);
    expectedVersion = positiveVersion(body?.expectedVersion);
    reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    confirmed = body?.confirmed === true;
    policyVersion = typeof body?.previewPolicyVersion === "string" ? body.previewPolicyVersion : "";
    if (!expectedVersion || !reason || reason.length > 200 || !confirmed || !policyVersion) {
      return error(requestId, 400, "invalid_master_operation", "Expected version, reason, confirmation and policy version are required");
    }
  }
  if (!expectedVersion) {
    return error(requestId, 400, "expected_version_required", "Expected version is required");
  }

  const handler = createRetireMasterHandler({
    db: env.DB, environment, definition: options.definition, actorId, expectedVersion,
  });
  const operations = new OperationsApplicationService(
    new OperationRegistry([handler]), options.auditLogger ?? consoleAuditLogger,
  );
  const operationRequest: OperationRequest = {
    definition: handler.definition, actorKind: "HUMAN", environment,
    target: { resourceType: "master_item", resourceId: itemId, scopeId },
    affectedCount: 1, expectedVersion, correlationId: requestId,
    ...(isPreview ? {} : { reason }),
  };
  const preview = operations.preview({ allowed: true }, operationRequest);
  const available = before.retiredAt === null && before.version === expectedVersion;
  if (isPreview) {
    return json({
      command: RETIRE_MASTER_ITEM, item: before, available,
      reasonCode: before.retiredAt !== null ? "already_retired"
        : before.version !== expectedVersion ? "stale_version" : null,
      preview, policyVersion: OPERATIONS_POLICY_VERSION,
    });
  }

  // Fail closed before reserving an idempotency key, so stale attempts can refresh.
  if (!available) {
    return error(requestId, 409, "master_state_conflict", "Master state has changed");
  }
  const mode = await new OperationModeGuard(
    new D1OperationModeStore(env.DB, environment), { environment, retryAfterSeconds: 60 },
  ).check(request);
  if (!mode.allowed) return operationModeRejectionResponse(mode, requestId);

  const guard = new IdempotencyHttpGuard(createD1IdempotencyHttpStore(env.DB));
  let idempotency;
  try {
    idempotency = await guard.begin({
      request, actorId, scopeId, action: "master_data:retire:" + options.definition.key,
    });
  } catch {
    return error(requestId, 503, "idempotency_unavailable", "Idempotency guard is unavailable");
  }
  if (idempotency.kind === "reject") return idempotencyRejectionResponse(idempotency, requestId);
  if (idempotency.kind === "replay") return idempotencyReplayResponse(idempotency, requestId);

  const result = await operations.execute(operationRequest, preview, {
    actorId,
    requestContext: { requestId, method: request.method, path: url.pathname },
    previewPolicyVersion: policyVersion,
    evidence: { confirmed, reason },
    executionId: crypto.randomUUID(),
  });
  const verified = result.execution.result === "SUCCESS" && result.verification.status === "PASSED";
  const status = verified ? 200 :
    result.execution.result === "CONFLICT" || result.execution.result === "REJECTED" ? 409 : 503;
  const after = await store.getItem(itemId, environment).then(project).catch(() => null);
  const response = json({ ...result, before, after }, status);
  if (verified) await guard.completeWithResponse(idempotency.execution, response.clone());
  else await guard.fail(idempotency.execution);
  return response;
};
