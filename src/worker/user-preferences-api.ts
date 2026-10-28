import { isRuntimeEnvironment } from "../shared/runtime/environment";
import {
  UserPreferenceValidationError,
  validateUserPreferencePatch,
  type UserPreferencePolicy,
  type UserPreferenceRecord,
} from "../shared/user-preferences";
import {
  UserPreferenceConflictError,
  type UserPreferencesStore,
} from "../shared/in-memory-user-preferences-store";
import { requireAuthenticatedUser } from "./authorization";
import {
  apiErrorResponse,
  csrfGuardFailureResponse,
  readJsonBody,
  requireCsrfProtection,
} from "./http";

export interface MyPreferencesApiEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}

export interface MyPreferencesApiOptions {
  readonly policy: UserPreferencePolicy;
  /** Must be durable and separately provisioned before this handler is mounted. */
  readonly store?: UserPreferencesStore;
}

const failure = (id: string, status: number, code: string, message: string): Response => {
  const response = apiErrorResponse({ status, code, message }, id);
  response.headers.set("cache-control", "no-store");
  return response;
};

const json = (value: unknown): Response =>
  Response.json(value, { headers: { "cache-control": "no-store" } });

const publicPreferences = (record: UserPreferenceRecord | null) => ({
  schemaVersion: 1 as const,
  version: record?.version ?? 0,
  values: record ? { locale: record.locale, timezone: record.timezone, theme: record.theme } : {
    locale: null, timezone: null, theme: null,
  },
  updatedAt: record?.updatedAt ?? null,
});

/**
 * Authenticated-user-only API contract. NOT mounted in worker.ts until an
 * approved, durable preference table/adapter is provisioned. Never substitute
 * the in-memory reference store for a production user preference source.
 */
export const handleMyPreferencesApi = async (
  request: Request,
  env: MyPreferencesApiEnvironment,
  requestId: string,
  options: MyPreferencesApiOptions,
): Promise<Response | null> => {
  if (new URL(request.url).pathname !== "/api/me/preferences") return null;
  if (request.method !== "GET" && request.method !== "PATCH") {
    return failure(requestId, 405, "method_not_allowed", "Method not allowed");
  }
  const environment = env.RUNTIME_ENVIRONMENT;
  if (!isRuntimeEnvironment(environment)) {
    return failure(requestId, 503, "runtime_environment_required", "Runtime environment is unavailable");
  }
  // No fallback to a process-global Map or a different-purpose D1 table.
  if (!options.store) {
    return failure(requestId, 503, "preferences_unavailable", "Preferences are unavailable");
  }

  let auth;
  try {
    auth = await requireAuthenticatedUser(request, env.DB);
  } catch {
    return failure(requestId, 503, "authentication_unavailable", "Authentication is unavailable");
  }
  if (!auth.allowed) {
    return failure(requestId, auth.status, auth.code, auth.message);
  }
  // Identity comes exclusively from the existing authenticated session, not URL/body.
  const userId = auth.user.id;

  if (request.method === "GET") {
    try {
      return json(publicPreferences(await options.store.get(userId, environment)));
    } catch {
      return failure(requestId, 503, "preferences_unavailable", "Preferences are unavailable");
    }
  }

  const csrf = await requireCsrfProtection(request);
  if (!csrf.allowed) {
    const response = csrfGuardFailureResponse(csrf, requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  }
  const body = await readJsonBody(request, { maxBytes: 2048 });
  if (!body.ok) {
    return failure(requestId, body.status, body.code, body.message);
  }
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
    return failure(requestId, 400, "invalid_preferences_request", "Invalid preferences request");
  }
  const input = body.value as Record<string, unknown>;
  const names = Object.keys(input);
  if (names.length !== 2 || !names.includes("expectedVersion") || !names.includes("patch") ||
      !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) {
    return failure(requestId, 400, "invalid_preferences_request", "Invalid preferences request");
  }
  let patch;
  try {
    patch = validateUserPreferencePatch(input.patch, options.policy);
  } catch (error) {
    if (error instanceof UserPreferenceValidationError) {
      return failure(requestId, 422, "validation_failed", "Preference value is invalid");
    }
    throw error;
  }
  try {
    const record = await options.store.update({
      userId, environment, expectedVersion: input.expectedVersion as number, patch,
    }, options.policy);
    return json(publicPreferences(record));
  } catch (error) {
    if (error instanceof UserPreferenceConflictError) {
      return failure(requestId, 409, "stale_update", "Preference version conflict");
    }
    if (error instanceof UserPreferenceValidationError) {
      return failure(requestId, 422, "validation_failed", "Preference value is invalid");
    }
    return failure(requestId, 503, "preferences_unavailable", "Preferences are unavailable");
  }
};
