import type { AuditLogger, RequestContext } from "../audit";
import {
  createOperationExecution,
  guardOperationExecution,
  writeOperationAudit,
  type OperationSafeguardEvidence,
} from "./execution-guard";
import { decideOperationPolicy, OPERATIONS_POLICY_VERSION } from "./policy";
import type {
  OperationAuthorizationDecision,
  OperationDefinition,
  OperationExecution,
  OperationExecutionResult,
  OperationPreview,
  OperationRequest,
  OperationVerification,
  VerificationStatus,
} from "./types";

export interface OperationHandlerResult {
  readonly result: OperationExecutionResult;
}

export interface OperationHandler {
  readonly definition: OperationDefinition;
  execute(request: OperationRequest): Promise<OperationHandlerResult>;
  verify?(
    request: OperationRequest,
    execution: OperationExecution,
  ): Promise<{ readonly status: VerificationStatus; readonly summary?: string }>;
}

export class DuplicateOperationRegistrationError extends Error {
  constructor(operationId: string) {
    super(`Duplicate operation registration: ${operationId}`);
    this.name = "DuplicateOperationRegistrationError";
  }
}

export class UnknownOperationError extends Error {
  constructor(operationId: string) {
    super(`Unknown operation: ${operationId}`);
    this.name = "UnknownOperationError";
  }
}

export class OperationRegistry {
  private readonly handlers = new Map<string, OperationHandler>();

  constructor(handlers: readonly OperationHandler[] = []) {
    for (const handler of handlers) this.register(handler);
  }

  register(handler: OperationHandler): void {
    if (this.handlers.has(handler.definition.id)) {
      throw new DuplicateOperationRegistrationError(handler.definition.id);
    }
    this.handlers.set(handler.definition.id, handler);
  }

  get(operationId: string): OperationHandler {
    const handler = this.handlers.get(operationId);
    if (!handler) throw new UnknownOperationError(operationId);
    return handler;
  }
}

export interface OperationExecutionContext {
  readonly actorId: string;
  readonly requestContext: RequestContext;
  readonly previewPolicyVersion: string;
  readonly evidence: OperationSafeguardEvidence;
  readonly executionId: string;
}

export interface OperationApplicationResult {
  readonly execution: OperationExecution;
  readonly verification: OperationVerification;
}

export class OperationsApplicationService {
  constructor(
    private readonly registry: OperationRegistry,
    private readonly auditLogger: AuditLogger,
  ) {}

  preview(
    authorization: OperationAuthorizationDecision,
    request: OperationRequest,
  ): OperationPreview {
    this.registry.get(request.definition.id);
    return decideOperationPolicy(authorization, request);
  }

  async execute(
    request: OperationRequest,
    preview: OperationPreview,
    context: OperationExecutionContext,
  ): Promise<OperationApplicationResult> {
    const handler = this.registry.get(request.definition.id);
    const auditMetadata = {
      ...context.requestContext,
      actorId: context.actorId,
      target: request.target,
      operationId: request.definition.id,
      correlationId: request.correlationId,
      affectedCount: request.affectedCount,
    };

    if (
      handler.definition.id !== preview.operationId ||
      request.correlationId !== preview.correlationId ||
      request.target.resourceType !== preview.target.resourceType ||
      request.target.resourceId !== preview.target.resourceId ||
      request.target.scopeId !== preview.target.scopeId
    ) {
      const execution = createOperationExecution({
        executionId: context.executionId,
        preview,
        result: "CONFLICT",
      });
      writeOperationAudit(this.auditLogger, auditMetadata, "failure", "preview_request_mismatch");
      return { execution, verification: this.notApplicable(execution.executionId) };
    }

    const guard = guardOperationExecution({
      actorId: context.actorId,
      actorKind: request.actorKind,
      preview,
      previewPolicyVersion: context.previewPolicyVersion,
      evidence: context.evidence,
    });

    if (!guard.allowed) {
      const execution = createOperationExecution({
        executionId: context.executionId,
        preview,
        result: "REJECTED",
      });
      writeOperationAudit(this.auditLogger, auditMetadata, "failure", guard.reason);
      return { execution, verification: this.notApplicable(execution.executionId) };
    }

    let result: OperationExecutionResult;
    try {
      result = (await handler.execute(request)).result;
    } catch {
      result = "UNKNOWN";
    }

    const execution = createOperationExecution({
      executionId: context.executionId,
      preview,
      result,
    });

    let verification: OperationVerification;
    if (!request.definition.requiresVerification || !handler.verify) {
      verification = this.notApplicable(execution.executionId);
    } else {
      try {
        const verified = await handler.verify(request, execution);
        verification = {
          executionId: execution.executionId,
          status: verified.status,
          ...(verified.summary ? { summary: verified.summary } : {}),
        };
      } catch {
        verification = { executionId: execution.executionId, status: "UNKNOWN" };
      }
    }

    writeOperationAudit(
      this.auditLogger,
      auditMetadata,
      result === "SUCCESS" ? "success" : "failure",
      result === "SUCCESS" ? undefined : `execution_${result.toLowerCase()}`,
    );
    return { execution, verification };
  }

  private notApplicable(executionId: string): OperationVerification {
    return { executionId, status: "NOT_APPLICABLE" };
  }
}

export { OPERATIONS_POLICY_VERSION };
