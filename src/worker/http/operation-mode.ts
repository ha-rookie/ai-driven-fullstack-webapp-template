import { isOperationMode, type OperationMode, type OperationModeStore } from "../../domain/operation-mode";
import { parseRuntimeEnvironment, type RuntimeEnvironment } from "../../shared/runtime";
import type { AuditEvent } from "../audit";
import { apiErrorResponse } from "./api-error";

export type OperationModeDecision =
  | { readonly allowed: true; readonly mode: OperationMode }
  | { readonly allowed: false; readonly reason: "read_only" | "maintenance" | "unavailable"; readonly retryAfterSeconds: number };

export interface OperationModeGuardOptions {
  readonly environment: RuntimeEnvironment;
  /** Project retry hint, not an estimate of when maintenance ends. */
  readonly retryAfterSeconds: number;
}

export const isMutationMethod = (method: string): boolean =>
  !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

export class OperationModeGuard {
  private readonly environment: RuntimeEnvironment;
  private readonly retryAfterSeconds: number;

  constructor(private readonly store: OperationModeStore, options: OperationModeGuardOptions) {
    this.environment = parseRuntimeEnvironment(options.environment);
    if (!Number.isSafeInteger(options.retryAfterSeconds) || options.retryAfterSeconds < 1) {
      throw new TypeError("Operation mode Retry-After must be a positive integer");
    }
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  async check(request: Request): Promise<OperationModeDecision> {
    const reject = (reason: "read_only" | "maintenance" | "unavailable"): OperationModeDecision =>
      ({ allowed: false, reason, retryAfterSeconds: this.retryAfterSeconds });
    try {
      const state = await this.store.read();
      if (state.environment !== this.environment || !isOperationMode(state.mode) ||
        !Number.isSafeInteger(state.version) || state.version < 1) return reject("unavailable");
      if (state.mode === "maintenance") return reject("maintenance");
      if (state.mode === "read-only" && isMutationMethod(request.method)) return reject("read_only");
      return { allowed: true, mode: state.mode };
    } catch {
      return reject("unavailable");
    }
  }
}

type Rejection = Extract<OperationModeDecision, { allowed: false }>;

export const operationModeRejectionResponse = (decision: Rejection, requestId: string): Response => {
  const mapping = {
    read_only: { code: "operation_read_only", message: "Updates are temporarily unavailable" },
    maintenance: { code: "service_in_maintenance", message: "Service is temporarily unavailable" },
    unavailable: { code: "operation_mode_unavailable", message: "Service is temporarily unavailable" },
  }[decision.reason];
  const response = apiErrorResponse({ status: 503, ...mapping }, requestId);
  response.headers.set("retry-after", String(decision.retryAfterSeconds));
  response.headers.set("cache-control", "no-store");
  return response;
};

export const operationModeRejectionAuditFields = (decision: Rejection): Omit<AuditEvent, "requestId" | "method" | "path"> => ({
  category: "system", action: "operation_mode_guard", outcome: "failure",
  resourceType: "operation_mode", reason: decision.reason,
});
