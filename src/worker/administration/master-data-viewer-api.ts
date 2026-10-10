import { isRuntimeEnvironment } from "../../shared/runtime";
import { requireAuthenticatedUser, requireScopedAuthorization, type RolePolicy } from "../authorization";
import { apiErrorResponse } from "../http";

const VIEW_ACTION = "master_data:view";
const PAGE_LIMIT = 50;
const HISTORY_LIMIT = 50;
const defaultPolicy: RolePolicy = { [VIEW_ACTION]: ["system_admin"] };

interface MasterItemRow {
  id: string;
  code: string;
  version: number;
  retired_at: string | null;
}
interface MasterRevisionRow {
  id: string;
  revision: number;
  label: string;
  enabled: number;
  effective_from: string;
  effective_to: string | null;
  display_order: number;
  parent_item_id: string | null;
}
export type MasterRevisionLifecycle = "current" | "future" | "expired" | "disabled" | "retired";

/** Half-open effective periods: from <= now < to. Read-only, not a replacement for #298 resolution. */
export const classifyMasterRevision = (
  revision: Pick<MasterRevisionRow, "effective_from" | "effective_to" | "enabled">,
  asOf: string,
  retiredAt: string | null,
): MasterRevisionLifecycle => {
  if (retiredAt !== null && retiredAt <= asOf) return "retired";
  if (asOf < revision.effective_from) return "future";
  if (revision.effective_to !== null && asOf >= revision.effective_to) return "expired";
  return revision.enabled === 1 ? "current" : "disabled";
};

export interface MasterDataViewerEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}

/**
 * Server-owned disclosure rules derived from the SAME allowlists and role
 * policies as the authoritative mutation APIs. Never trust browser config.
 * A listed operation is only an available link, not an execution authorization.
 */
export interface MasterViewerOperationDisclosure {
  readonly kind: "schedule" | "retire";
  readonly masterKey: string;
  readonly allowedItemIds: readonly string[];
  readonly action: string;
  readonly authorizationPolicy: RolePolicy;
}

/** Inject project-approved definitions and scope; no table selector or arbitrary master lookup. */
export interface MasterDataViewerOptions {
  readonly scopeId: string;
  readonly masterKeys: readonly string[];
  readonly operations?: readonly MasterViewerOperationDisclosure[];
  readonly authorizationPolicy?: RolePolicy;
  readonly now?: () => Date;
}

const error = (requestId: string, status: number, code: string, message: string): Response =>
  apiErrorResponse({ status, code, message }, requestId);

const json = (body: unknown): Response => Response.json(body, {
  headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
});

const validItemId = (value: string): boolean => /^[A-Za-z0-9_.:-]{1,128}$/u.test(value);

export const handleMasterDataViewerApi = async (
  request: Request,
  env: MasterDataViewerEnvironment,
  requestId: string,
  options: MasterDataViewerOptions,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== "/api/admin/master-data") return null;
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

  const scopeId = url.searchParams.get("scopeId");
  const masterKey = url.searchParams.get("masterKey");
  const itemId = url.searchParams.get("itemId");
  if (!scopeId || !masterKey || (itemId !== null && !validItemId(itemId))) {
    return error(requestId, 400, "invalid_master_query", "Master query is invalid");
  }
  // A master has no row-level scope column in #298. Bind it to a trusted project scope.
  if (scopeId !== options.scopeId) {
    return error(requestId, 403, "forbidden", "Access denied");
  }

  try {
    const authorization = await requireScopedAuthorization({
      db: env.DB,
      userId: authentication.user.id,
      policy: options.authorizationPolicy ?? defaultPolicy,
      action: VIEW_ACTION,
      requestedScopeId: scopeId,
      resourceScopeId: options.scopeId,
    });
    if (!authorization.allowed) {
      return error(requestId, authorization.status, authorization.code, authorization.message);
    }
  } catch {
    return error(requestId, 503, "authorization_unavailable", "Authorization is unavailable");
  }

  if (!options.masterKeys.includes(masterKey)) {
    return error(requestId, 404, "master_definition_not_found", "Master definition was not found");
  }

  const asOf = (options.now ?? (() => new Date()))().toISOString();
  const context = { environment, scopeId, masterKey, asOf };
  try {
    if (itemId === null) {
      const result = await env.DB.prepare(
        "SELECT id, code, version, retired_at FROM master_items " +
        "WHERE environment = ? AND master_key = ? ORDER BY code, id LIMIT ?",
      ).bind(environment, masterKey, PAGE_LIMIT + 1).all<MasterItemRow>();
      const rows = result.results ?? [];
      return json({
        ...context,
        items: rows.slice(0, PAGE_LIMIT).map((row) => ({
          id: row.id, code: row.code, version: row.version, retiredAt: row.retired_at,
        })),
        hasMore: rows.length > PAGE_LIMIT,
        limit: PAGE_LIMIT,
      });
    }

    const item = await env.DB.prepare(
      "SELECT id, code, version, retired_at FROM master_items " +
      "WHERE id = ? AND environment = ? AND master_key = ?",
    ).bind(itemId, environment, masterKey).first<MasterItemRow>();
    if (!item) return error(requestId, 404, "master_item_not_found", "Master item was not found");

    // Read access alone never grants a mutation link. Only the server can
    // disclose a per-item operation, after its own scope/role/target checks.
    // Production demo mutations remain gated even for privileged readers.
    const allowedOperations: Array<"schedule" | "retire"> = [];
    if (environment !== "production" && item.retired_at === null) {
      for (const operation of options.operations ?? []) {
        if (operation.masterKey !== masterKey || !operation.allowedItemIds.includes(item.id)
          || allowedOperations.includes(operation.kind)) continue;
        let authorization;
        try {
          authorization = await requireScopedAuthorization({
            db: env.DB, userId: authentication.user.id, policy: operation.authorizationPolicy,
            action: operation.action, requestedScopeId: scopeId, resourceScopeId: options.scopeId,
          });
        } catch {
          return error(requestId, 503, "authorization_unavailable", "Authorization is unavailable");
        }
        if (authorization.allowed) allowedOperations.push(operation.kind);
      }
    }

    const result = await env.DB.prepare(
      "SELECT id, revision, label, enabled, effective_from, effective_to, display_order, parent_item_id " +
      "FROM master_revisions WHERE master_item_id = ? AND environment = ? " +
      "ORDER BY revision DESC LIMIT ?",
    ).bind(item.id, environment, HISTORY_LIMIT + 1).all<MasterRevisionRow>();
    const rows = result.results ?? [];
    return json({
      ...context,
      item: { id: item.id, code: item.code, version: item.version, retiredAt: item.retired_at },
      allowedOperations, // provisional disclosure only; execute rechecks all guards
      revisions: rows.slice(0, HISTORY_LIMIT).map((row) => ({
        id: row.id,
        revision: row.revision,
        label: row.label,
        enabled: row.enabled === 1,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
        displayOrder: row.display_order,
        parentItemId: row.parent_item_id,
        lifecycle: classifyMasterRevision(row, asOf, item.retired_at),
      })),
      hasMore: rows.length > HISTORY_LIMIT,
      limit: HISTORY_LIMIT,
    });
  } catch {
    return error(requestId, 503, "master_data_unavailable", "Master data is unavailable");
  }
};
