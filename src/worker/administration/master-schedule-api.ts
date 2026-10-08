import { D1OperationModeStore } from "../../infrastructure/d1-operation-mode-store";
import { isRuntimeEnvironment } from "../../shared/runtime";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import {
  consoleAuditLogger, prepareDurableAuditRecord, sha256Text,
  type AuditLogger, type PreparedDurableAuditRecord,
} from "../audit";
import {
  apiErrorResponse, csrfGuardFailureResponse, readJsonBody, requireCsrfProtection,
  OperationModeGuard, operationModeRejectionResponse,
} from "../http";
import {
  createD1IdempotencyHttpStore, IdempotencyHttpGuard,
  idempotencyRejectionResponse, idempotencyReplayResponse,
} from "../http/idempotency";
import {
  D1MasterDataStore, MasterDataError, MasterDataService,
  StaticMasterDefinitionRegistry, type MasterDefinition, type ResolvedMasterValue,
} from "../master-data";
import {
  createOperationAuditEvent, OperationRegistry, OperationsApplicationService, OPERATIONS_POLICY_VERSION,
  type OperationDefinition, type OperationHandler, type OperationRequest,
} from "../operations";

export const SCHEDULE_MASTER_REVISION = "SCHEDULE_MASTER_REVISION";
const ACTION = "master_data:schedule";
const OPERATION: OperationDefinition = Object.freeze({
  id: SCHEDULE_MASTER_REVISION, capability: ACTION, baseRisk: "CONTROLLED_CHANGE",
  reversible: false, idempotent: false, externalSideEffect: false, requiresVerification: true,
});
const defaultPolicy: RolePolicy = { [ACTION]: ["system_admin"] };
export interface MasterScheduleEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}
export interface MasterScheduleOptions {
  readonly scopeId: string;
  readonly definition: MasterDefinition;
  readonly allowedItemIds: readonly string[];
  /** Per-reference-item permitted status transition: false=disable, true=enable. */
  readonly availabilityTransitions?: Readonly<Record<string, boolean>>;
  /** Explicit project Demo items permitted to alter displayOrder only. */
  readonly orderChangeItemIds?: readonly string[];
  readonly authorizationPolicy?: RolePolicy;
  readonly auditLogger?: AuditLogger;
  readonly now?: () => Date;
}
const error = (id: string, status: number, code: string, message: string): Response =>
  apiErrorResponse({ status, code, message }, id);
const json = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const positive = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
const queryVersion = (value: string | null): number | null =>
  value && /^[1-9][0-9]{0,12}$/u.test(value) ? positive(Number(value)) : null;
const isoFuture = (value: unknown, now: string): value is string =>
  typeof value === "string" && value.length === 24
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
    && value > now;
const validOrder = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value)
  && value >= -1_000_000 && value <= 1_000_000;
const queryOrder = (value: string | null): number | undefined | null => {
  if (value === null) return undefined;
  if (!/^-?(0|[1-9][0-9]{0,6})$/u.test(value)) return null;
  const result = Number(value);
  return validOrder(result) ? result : null;
};
const validLabel = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 256) return false;
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
  });
};

export const createScheduleMasterHandler = (input: {
  readonly db: D1Database;
  readonly environment: string;
  readonly definition: MasterDefinition;
  readonly actorId: string;
  readonly expectedVersion: number;
  readonly priorRevisionId: string;
  readonly effectiveFrom: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly displayOrder?: number;
  readonly now: () => Date;
  readonly onScheduled?: (value: ResolvedMasterValue) => void;
  readonly getAudit?: () => PreparedDurableAuditRecord | undefined;
}): OperationHandler => {
  const store = new D1MasterDataStore(input.db);
  const service = new MasterDataService({
    environment: input.environment, store,
    definitions: new StaticMasterDefinitionRegistry([input.definition]),
    now: input.now,
  });
  return {
    definition: OPERATION,
    async execute(request) {
      if (request.definition.id !== SCHEDULE_MASTER_REVISION
        || request.expectedVersion !== input.expectedVersion || !request.reason?.trim()) {
        return { result: "CONFLICT" };
      }
      try {
        const scheduled = await service.scheduleRevision({
          itemId: request.target.resourceId,
          priorRevisionId: input.priorRevisionId,
          expectedItemVersion: input.expectedVersion,
          actorId: input.actorId,
          effectiveFrom: input.effectiveFrom,
          label: input.label,
          enabled: input.enabled,
          displayOrder: input.displayOrder,
          durableAudit: input.getAudit?.(),
        });
        input.onScheduled?.(scheduled);
        return { result: "SUCCESS" };
      } catch (caught) {
        if (caught instanceof MasterDataError) {
          if (caught.code === "conflict" || caught.code === "retired"
            || caught.code === "not_found" || caught.code === "overlapping_revision") {
            return { result: "CONFLICT" };
          }
          if (caught.code === "invalid_input") return { result: "REJECTED" };
        }
        throw caught;
      }
    },
    async verify(request, execution) {
      if (execution.result !== "SUCCESS") return { status: "NOT_APPLICABLE" };
      const [current, previous, newValue] = await Promise.all([
        store.getItem(request.target.resourceId, input.environment),
        store.getRevisionById(input.priorRevisionId, input.environment),
        store.resolveAt(request.target.resourceId, input.environment, input.effectiveFrom, {
          includeDisabled: true,
        }),
      ]);
      return current?.version === input.expectedVersion + 1
        && current.updatedBy === input.actorId
        && previous?.revision.effectiveTo === input.effectiveFrom
        && newValue?.revision.effectiveFrom === input.effectiveFrom
        && newValue.revision.label === input.label
        && newValue.revision.enabled === input.enabled
        && (input.displayOrder === undefined || newValue.revision.displayOrder === input.displayOrder)
        && newValue.revision.id !== input.priorRevisionId
        ? { status: "PASSED", summary: "Previous interval closed and future revision resolves at cutoff" }
        : { status: "FAILED", summary: "Master future cutover post-state mismatch" };
    },
  };
};

export const handleMasterScheduleApi = async (
  request: Request, env: MasterScheduleEnvironment,
  requestId: string, options: MasterScheduleOptions,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const previewPath = "/api/admin/master-operations/schedule/preview";
  const executePath = "/api/admin/master-operations/schedule/execute";
  if (url.pathname !== previewPath && url.pathname !== executePath) return null;
  const isPreview = url.pathname === previewPath;
  if (request.method !== (isPreview ? "GET" : "POST")) {
    return error(requestId, 405, "method_not_allowed", "Method not allowed");
  }
  const environment = env.RUNTIME_ENVIRONMENT;
  if (!environment || !isRuntimeEnvironment(environment)) {
    return error(requestId, 503, "runtime_environment_required", "Runtime environment is unavailable");
  }
  if (environment === "production") {
    return error(requestId, 403, "human_gate_required", "Production scheduling requires human approval");
  }
  let auth;
  try { auth = await requireAuthenticatedUser(request, env.DB); }
  catch { return error(requestId, 503, "authentication_unavailable", "Authentication is unavailable"); }
  if (!auth.allowed) return error(requestId, auth.status, auth.code, auth.message);
  const scopeId = url.searchParams.get("scopeId");
  const itemId = url.searchParams.get("itemId");
  if (scopeId !== options.scopeId || !itemId || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(itemId)) {
    return error(requestId, 403, "forbidden", "Access denied");
  }
  try {
    const access = await requireScopedAuthorization({
      db: env.DB, userId: auth.user.id,
      policy: options.authorizationPolicy ?? defaultPolicy, action: ACTION,
      requestedScopeId: scopeId, resourceScopeId: options.scopeId,
    });
    if (!access.allowed) return error(requestId, access.status, access.code, access.message);
  } catch { return error(requestId, 503, "authorization_unavailable", "Authorization is unavailable"); }
  if (!options.allowedItemIds.includes(itemId)) {
    return error(requestId, 404, "master_operation_not_available", "Master operation is not available");
  }
  const now = options.now ?? (() => new Date());
  const at = now().toISOString();
  let expectedVersion = isPreview ? queryVersion(url.searchParams.get("expectedVersion")) : null;
  let effectiveFrom: unknown = isPreview ? url.searchParams.get("effectiveFrom") : undefined;
  let label: unknown = isPreview ? url.searchParams.get("label") : undefined;
  let enabled: unknown = isPreview ? (url.searchParams.get("enabled") ?? "true") : undefined;
  let displayOrder: unknown = isPreview ? queryOrder(url.searchParams.get("displayOrder")) : undefined;
  let priorRevisionId = "";
  let reason = "", policyVersion = "", confirmed = false;
  if (!isPreview) {
    const csrf = await requireCsrfProtection(request);
    if (!csrf.allowed) return csrfGuardFailureResponse(csrf, requestId);
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(requestId, parsed.status, parsed.code, parsed.message);
    const body = asObject(parsed.value);
    expectedVersion = positive(body?.expectedVersion);
    effectiveFrom = body?.effectiveFrom;
    label = body?.label;
    enabled = body?.enabled ?? true;
    displayOrder = body?.displayOrder;
    priorRevisionId = typeof body?.priorRevisionId === "string" ? body.priorRevisionId : "";
    reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    policyVersion = typeof body?.previewPolicyVersion === "string" ? body.previewPolicyVersion : "";
    confirmed = body?.confirmed === true;
  }
  if (typeof enabled === "string" && isPreview) {
    if (enabled === "true") enabled = true;
    else if (enabled === "false") enabled = false;
  }
  if (!expectedVersion || !isoFuture(effectiveFrom, at) || !validLabel(label)
    || typeof enabled !== "boolean"
    || (displayOrder !== undefined && !validOrder(displayOrder))
    || (!isPreview && (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(priorRevisionId)
      || reason.length < 1 || reason.length > 200 || !confirmed || !policyVersion))) {
    return error(requestId, 400, "invalid_schedule_request", "Valid future timestamp, label, version, and safeguards are required");
  }
  const newLabel = label.trim();
  const store = new D1MasterDataStore(env.DB);
  let item, current;
  try {
    [item, current] = await Promise.all([
      store.getItem(itemId, environment),
      store.resolveAt(itemId, environment, at, { includeDisabled: true }),
    ]);
  } catch { return error(requestId, 503, "master_data_unavailable", "Master data is unavailable"); }
  if (!item || item.masterKey !== options.definition.key) {
    return error(requestId, 404, "master_item_not_found", "Master item was not found");
  }
  const expectedPrior = current?.revision.id ?? null;
  const availabilityTransition = options.availabilityTransitions?.[itemId];
  const isOrderDemo = options.orderChangeItemIds?.includes(itemId) === true;
  // Three disjoint project-specific capabilities: label-only, availability-only, order-only.
  // Never allow an unapproved item to gain an unintended mutation dimension.
  const allowedTransition = isOrderDemo
    ? current !== null && newLabel === current.revision.label
      && enabled === current.revision.enabled && displayOrder !== undefined
      && displayOrder !== current.revision.displayOrder
    : availabilityTransition === undefined
      ? enabled === true && displayOrder === undefined
      : enabled === availabilityTransition && current !== null
        && enabled !== current.revision.enabled && newLabel === current.revision.label
        && displayOrder === undefined;
  const available = allowedTransition && item.retiredAt === null && item.version === expectedVersion
    && current?.revision.effectiveTo === null
    && current.revision.effectiveFrom < effectiveFrom
    && (isPreview || priorRevisionId === expectedPrior);
  let scheduled: ResolvedMasterValue | undefined;
  let auditReceipt: PreparedDurableAuditRecord | undefined;
  const handler = createScheduleMasterHandler({
    db: env.DB, environment, definition: options.definition, actorId: auth.user.id,
    expectedVersion, priorRevisionId: isPreview ? (expectedPrior ?? "") : priorRevisionId,
    effectiveFrom, label: newLabel, enabled, displayOrder, now,
    onScheduled: (value) => { scheduled = value; },
    getAudit: () => auditReceipt,
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
  if (isPreview) {
    return json({
      command: SCHEDULE_MASTER_REVISION, item: {
        id: item.id, code: item.code, version: item.version, retiredAt: item.retiredAt,
      },
      priorRevisionId: expectedPrior, currentLabel: current?.revision.label ?? null,
      currentEnabled: current?.revision.enabled ?? null, enabled,
      currentDisplayOrder: current?.revision.displayOrder ?? null,
      displayOrder: displayOrder ?? current?.revision.displayOrder ?? null,
      available,
      reasonCode: item.retiredAt !== null ? "retired" : item.version !== expectedVersion
        ? "stale_version" : !current ? "no_current_revision"
          : current.revision.effectiveTo !== null ? "not_open_ended"
            : !allowedTransition ? "availability_transition_not_allowed" : null,
      preview, policyVersion: OPERATIONS_POLICY_VERSION, effectiveFrom, label: newLabel,
    });
  }
  const mode = await new OperationModeGuard(
    new D1OperationModeStore(env.DB, environment), { environment, retryAfterSeconds: 60 },
  ).check(request);
  if (!mode.allowed) return operationModeRejectionResponse(mode, requestId);
  const idempotency = new IdempotencyHttpGuard(createD1IdempotencyHttpStore(env.DB));
  let decision;
  try {
    decision = await idempotency.begin({
      request, actorId: auth.user.id, scopeId, action: "master_data:schedule:" + options.definition.key,
    });
  } catch { return error(requestId, 503, "idempotency_unavailable", "Idempotency guard is unavailable"); }
  if (decision.kind === "reject") return idempotencyRejectionResponse(decision, requestId);
  if (decision.kind === "replay") return idempotencyReplayResponse(decision, requestId);
  if (!available) {
    await idempotency.fail(decision.execution);
    return error(requestId, 409, "master_state_conflict", "Master has changed or is not eligible for schedule");
  }
  try {
    auditReceipt = await prepareDurableAuditRecord(createOperationAuditEvent({
      requestId, method: request.method, path: url.pathname, actorId: auth.user.id,
      target: operationRequest.target, operationId: SCHEDULE_MASTER_REVISION,
      correlationId: requestId, affectedCount: 1,
    }, "success", "reason_sha256:" + await sha256Text(reason)), environment);
  } catch {
    await idempotency.fail(decision.execution);
    return error(requestId, 503, "audit_unavailable", "Durable audit preparation failed");
  }
  const result = await operations.execute(operationRequest, preview, {
    actorId: auth.user.id, requestContext: { requestId, method: request.method, path: url.pathname },
    previewPolicyVersion: policyVersion, evidence: { confirmed, reason },
    executionId: crypto.randomUUID(),
  });
  const verified = result.execution.result === "SUCCESS" && result.verification.status === "PASSED";
  const status = verified ? 200
    : result.execution.result === "CONFLICT" || result.execution.result === "REJECTED" ? 409 : 503;
  const response = json({
    ...result, scheduled: scheduled ? {
      itemVersion: scheduled.item.version, revisionId: scheduled.revision.id,
      label: scheduled.revision.label, enabled: scheduled.revision.enabled,
      displayOrder: scheduled.revision.displayOrder,
      effectiveFrom: scheduled.revision.effectiveFrom,
    } : null,
  }, status);
  if (verified) await idempotency.completeWithResponse(decision.execution, response.clone());
  else await idempotency.fail(decision.execution);
  return response;
};
