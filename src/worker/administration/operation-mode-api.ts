import { isOperationMode, isSafeOperationMetadata, type OperationModeState, type OperationModeStore } from "../../domain/operation-mode";
import { isRuntimeEnvironment, type RuntimeEnvironment } from "../../shared/runtime";
import type { AuditEvent } from "../audit";
import type { SessionPolicy } from "../auth";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import { apiErrorResponse, readJsonBody, requireCsrfProtection, rateLimitRejectionResponse,
  type RateLimitGuard, type RateLimitPolicy } from "../http";
import { fromAuthenticationFailure, fromAuthorizationFailure, fromCsrfFailure, fromRateLimitRejection,
  type SecurityRejectionEvent } from "../security";

type AuditFields = Omit<AuditEvent, "requestId" | "method" | "path">;

export interface OperationModeApiOptions {
  readonly store: OperationModeStore;
  readonly environment: RuntimeEnvironment;
  /** Trusted Project-configured scope for this environment's control plane. */
  readonly operatorScopeId: string;
  readonly authorizationPolicy: RolePolicy;
  readonly rateLimitGuard: RateLimitGuard;
  readonly rateLimitPolicy: RateLimitPolicy;
  readonly sessionPolicy?: SessionPolicy;
  readonly securityEventSink?: (event: SecurityRejectionEvent) => void;
}

const safely = (effect: () => void): void => {
  try { effect(); } catch { /* Best-effort telemetry cannot alter an operation's result. */ }
};

const validState = (state: OperationModeState, environment: RuntimeEnvironment): boolean =>
  state.environment === environment && isOperationMode(state.mode) &&
  Number.isSafeInteger(state.version) && state.version >= 1 &&
  typeof state.updatedAt === "string" && Number.isFinite(Date.parse(state.updatedAt)) &&
  isSafeOperationMetadata(state.updatedBy, 128) && isSafeOperationMetadata(state.reason, 512);

export const handleOperationModeApi = async (
  request: Request, db: D1Database, audit: (event: AuditFields) => void,
  requestId: string, options: OperationModeApiOptions,
): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  if (path !== "/api/admin/operation-mode") return null;

  const finish = (response: Response): Response => {
    response.headers.set("x-request-id", requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  };
  const error = (status: number, code: string, message: string): Response =>
    finish(apiErrorResponse({ status, code, message }, requestId));
  const unavailable = (code = "operation_mode_unavailable"): Response =>
    error(503, code, "Service is temporarily unavailable");
  if (request.method !== "GET" && request.method !== "PATCH") {
    const response = error(405, "method_not_allowed", "Method not allowed");
    response.headers.set("allow", "GET, PATCH");
    return response;
  }
  if (!isRuntimeEnvironment(options.environment) || !isSafeOperationMetadata(options.operatorScopeId, 128)) {
    return unavailable();
  }
  const context = { requestId, method: request.method, path, scopeId: options.operatorScopeId,
    resourceType: "operation_mode", resourceId: options.environment } as const;
  const emit = (event: SecurityRejectionEvent): void => safely(() => options.securityEventSink?.(event));

  let authentication;
  try { authentication = await requireAuthenticatedUser(request, db, options.sessionPolicy); }
  catch { return unavailable("authentication_unavailable"); }
  if (!authentication.allowed) {
    emit(fromAuthenticationFailure(authentication, context));
    return error(authentication.status, authentication.code, authentication.message);
  }
  const actorId = authentication.user.id;
  if (!isSafeOperationMetadata(actorId, 128)) return unavailable("authentication_unavailable");
  const authenticatedContext = { ...context, actorId };
  const rateInput = { policy: options.rateLimitPolicy, subject: { kind: "actor" as const, id: actorId } };
  try {
    const rate = await options.rateLimitGuard.check(rateInput);
    if (rate.kind === "reject") {
      emit(fromRateLimitRejection(rate, rateInput, authenticatedContext));
      return finish(rateLimitRejectionResponse(rate, requestId));
    }
  } catch { return unavailable("rate_limit_unavailable"); }

  if (request.method === "PATCH") {
    try {
      const csrf = await requireCsrfProtection(request);
      if (!csrf.allowed) {
        emit(fromCsrfFailure(csrf, authenticatedContext));
        return error(csrf.status, csrf.code, csrf.message);
      }
    } catch { return unavailable(); }
  }
  let authorization;
  try {
    authorization = await requireScopedAuthorization({ db, userId: actorId,
      policy: options.authorizationPolicy,
      action: request.method === "GET" ? "operation_mode:read" : "operation_mode:update",
      requestedScopeId: options.operatorScopeId, resourceScopeId: options.operatorScopeId });
  } catch { return unavailable("authorization_unavailable"); }
  if (!authorization.allowed) {
    emit(fromAuthorizationFailure(authorization, authenticatedContext));
    return error(authorization.status, authorization.code, authorization.message);
  }

  const auditFields = { category: "system" as const, action: "operation_mode.update", actorId,
    scopeId: options.operatorScopeId, resourceType: "operation_mode", resourceId: options.environment };
  const recordFailure = (reason: string): void => safely(() => audit({ ...auditFields, outcome: "failure", reason }));
  const view = (state: OperationModeState): Response => finish(new Response(JSON.stringify({
    state: { environment: state.environment, mode: state.mode, version: state.version, updatedAt: state.updatedAt }, requestId,
  }), { headers: { "content-type": "application/json; charset=utf-8" } }));

  if (request.method === "GET") {
    try {
      const state = await options.store.read();
      return validState(state, options.environment) ? view(state) : unavailable();
    } catch { return unavailable(); }
  }
  const result = await readJsonBody(request);
  if (!result.ok) return error(result.status, result.code, result.message);
  const body = result.value as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    body.targetEnvironment !== options.environment || !isOperationMode(body.mode) ||
    typeof body.expectedVersion !== "number" || !Number.isSafeInteger(body.expectedVersion) ||
    body.expectedVersion < 1 || body.expectedVersion >= Number.MAX_SAFE_INTEGER ||
    !isSafeOperationMetadata(body.reason, 200)) {
    return error(400, "invalid_request", "Explicit environment, mode, observed version and reason are required");
  }
  const conflict = (): Response => {
    recordFailure("conflict");
    return error(409, "operation_mode_conflict", "Operation mode changed; reload before retrying");
  };
  const operatorReason = body.reason;
  try {
    const before = await options.store.read();
    if (!validState(before, options.environment)) throw new Error("Invalid mode state");
    if (before.version !== body.expectedVersion) return conflict();
    const update = await options.store.update({ mode: body.mode, expectedVersion: body.expectedVersion,
      updatedBy: actorId, reason: body.reason });
    if (update.kind === "conflict") return conflict();
    if (!validState(update.state, options.environment) || update.state.version !== body.expectedVersion + 1 ||
      update.state.mode !== body.mode || update.state.updatedBy !== actorId || update.state.reason !== body.reason) {
      throw new Error("Invalid mode update result");
    }
    safely(() => audit({ ...auditFields, outcome: "success", operationModeChange: {
      environment: options.environment, beforeMode: before.mode, afterMode: update.state.mode,
      beforeVersion: before.version, afterVersion: update.state.version, reason: operatorReason,
    } }));
    return view(update.state);
  } catch {
    recordFailure("dependency_failure");
    return unavailable();
  }
};
