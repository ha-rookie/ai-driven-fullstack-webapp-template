import type { OperationDefinition, OperationHandler, OperationHandlerResult, OperationRequest } from "../operations";
import type { OperationRiskLevel } from "../operations";

export interface DataCorrectionCommandDefinition {
  readonly key: string;
  readonly version: number;
  readonly capability: string;
  readonly risk: OperationRiskLevel;
  readonly reversible: boolean;
  readonly idempotent: boolean;
  readonly requiresReason: true;
  readonly supportsPreview: boolean;
  readonly requiresVerification: boolean;
}

export interface DataCorrectionProjection {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly version: number;
  readonly state: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DataCorrectionExecutionResult {
  readonly result: OperationHandlerResult["result"];
  readonly before?: DataCorrectionProjection;
  readonly after?: DataCorrectionProjection;
  readonly reasonCode?: string;
}

export interface DataCorrectionPreviewResult {
  readonly available: boolean;
  readonly before?: DataCorrectionProjection;
  readonly reasonCode?: string;
}

export interface DataCorrectionAdapter {
  readonly definition: DataCorrectionCommandDefinition;
  inspect?(input: {
    readonly targetId: string;
    readonly expectedVersion: number;
  }): Promise<DataCorrectionPreviewResult>;
  execute(input: {
    readonly actorId: string;
    readonly targetId: string;
    readonly expectedVersion: number;
    readonly reason: string;
  }): Promise<DataCorrectionExecutionResult>;
  verify?(input: {
    readonly targetId: string;
    readonly expectedVersion: number;
  }): Promise<{ readonly passed: boolean; readonly summary?: string }>;
}

export class DataCorrectionRegistry {
  private readonly adapters = new Map<string, DataCorrectionAdapter>();

  constructor(adapters: readonly DataCorrectionAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: DataCorrectionAdapter): void {
    if (!/^[A-Z][A-Z0-9_]{2,63}$/u.test(adapter.definition.key)) {
      throw new TypeError("Data correction command key is invalid");
    }
    if (!Number.isSafeInteger(adapter.definition.version) || adapter.definition.version < 1) {
      throw new RangeError("Data correction command version must be a positive integer");
    }
    if (this.adapters.has(adapter.definition.key)) {
      throw new Error(`Duplicate data correction command: ${adapter.definition.key}`);
    }
    this.adapters.set(adapter.definition.key, adapter);
  }

  get(commandKey: string): DataCorrectionAdapter | null {
    return this.adapters.get(commandKey) ?? null;
  }
}

export const toCorrectionOperationDefinition = (
  definition: DataCorrectionCommandDefinition,
): OperationDefinition => Object.freeze({
  id: definition.key,
  capability: definition.capability,
  baseRisk: definition.risk,
  reversible: definition.reversible,
  idempotent: definition.idempotent,
  externalSideEffect: false,
  requiresVerification: definition.requiresVerification,
});

export const createDataCorrectionOperationHandler = (input: {
  readonly adapter: DataCorrectionAdapter;
  readonly actorId: string;
  readonly expectedVersion: number;
  readonly onResult?: (result: DataCorrectionExecutionResult) => void;
}): OperationHandler => {
  const operationDefinition = toCorrectionOperationDefinition(input.adapter.definition);

  return {
    definition: operationDefinition,
    async execute(request: OperationRequest): Promise<OperationHandlerResult> {
      if (
        request.definition.id !== operationDefinition.id
        || request.definition.capability !== operationDefinition.capability
        || request.target.resourceId.length === 0
        || request.expectedVersion !== input.expectedVersion
        || typeof request.reason !== "string"
        || request.reason.trim().length === 0
      ) {
        return { result: "CONFLICT" };
      }

      const result = await input.adapter.execute({
        actorId: input.actorId,
        targetId: request.target.resourceId,
        expectedVersion: input.expectedVersion,
        reason: request.reason.trim(),
      });
      input.onResult?.(result);
      return { result: result.result };
    },
    async verify(request, execution) {
      if (!input.adapter.definition.requiresVerification || !input.adapter.verify) {
        return { status: "NOT_APPLICABLE" };
      }
      if (execution.result !== "SUCCESS") {
        return { status: "UNKNOWN", summary: "Correction did not complete successfully" };
      }
      const verification = await input.adapter.verify({
        targetId: request.target.resourceId,
        expectedVersion: input.expectedVersion + 1,
      });
      return verification.passed
        ? { status: "PASSED", ...(verification.summary ? { summary: verification.summary } : {}) }
        : { status: "FAILED", ...(verification.summary ? { summary: verification.summary } : {}) };
    },
  };
};
