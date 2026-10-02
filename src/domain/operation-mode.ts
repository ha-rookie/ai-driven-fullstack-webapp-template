import type { RuntimeEnvironment } from "../shared/runtime";

export const OPERATION_MODES = ["normal", "read-only", "maintenance"] as const;
export type OperationMode = (typeof OPERATION_MODES)[number];
export const isOperationMode = (value: unknown): value is OperationMode =>
  typeof value === "string" && OPERATION_MODES.includes(value as OperationMode);

export interface OperationModeState {
  readonly environment: RuntimeEnvironment;
  readonly mode: OperationMode;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly reason: string;
}

export interface OperationModeUpdate {
  readonly mode: OperationMode;
  /** Zero explicitly initializes an absent environment; otherwise use the observed version. */
  readonly expectedVersion: number;
  readonly updatedBy: string;
  readonly reason: string;
}

export type OperationModeUpdateResult =
  | { readonly kind: "updated"; readonly state: OperationModeState }
  | { readonly kind: "conflict" };

export class OperationModeUnavailableError extends Error {
  constructor(readonly reason: "missing" | "invalid_state" | "dependency_failure") {
    super("Operation mode is unavailable");
    this.name = "OperationModeUnavailableError";
  }
}

export interface OperationModeStore {
  read(): Promise<OperationModeState>;
  update(input: OperationModeUpdate): Promise<OperationModeUpdateResult>;
}

export const isSafeOperationMetadata = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maxLength &&
  ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
