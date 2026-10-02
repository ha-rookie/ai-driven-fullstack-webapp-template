export type AuditCategory =
  | "authentication"
  | "authorization"
  | "mutation"
  | "system";

export type AuditOutcome = "success" | "failure";

export interface RequestContext {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
}

export interface AuditEvent extends RequestContext {
  readonly category: AuditCategory;
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly actorId?: string | null;
  readonly scopeId?: string | null;
  readonly resourceType?: string;
  readonly resourceId?: string | null;
  readonly reason?: string;
  readonly affectedCount?: number;
  readonly operationModeChange?: {
    readonly environment: import("../../shared/runtime").RuntimeEnvironment;
    readonly beforeMode: import("../../domain/operation-mode").OperationMode;
    readonly afterMode: import("../../domain/operation-mode").OperationMode;
    readonly beforeVersion: number;
    readonly afterVersion: number;
    readonly reason: string;
  };
}

export interface StructuredAuditRecord extends AuditEvent {
  readonly kind: "audit";
  readonly timestamp: string;
}

export interface AuditLogger {
  write(event: AuditEvent): void;
}
