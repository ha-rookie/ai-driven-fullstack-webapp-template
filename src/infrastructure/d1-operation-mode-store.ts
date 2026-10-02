import {
  isOperationMode, isSafeOperationMetadata, OperationModeUnavailableError,
  type OperationModeState, type OperationModeStore, type OperationModeUpdate,
  type OperationModeUpdateResult,
} from "../domain/operation-mode";
import { parseRuntimeEnvironment, systemClock, type Clock, type RuntimeEnvironment } from "../shared/runtime";

const columns = "environment, mode, version, updated_at AS updatedAt, updated_by AS updatedBy, reason";

export class D1OperationModeStore implements OperationModeStore {
  private readonly environment: RuntimeEnvironment;

  constructor(private readonly db: D1Database, environment: RuntimeEnvironment, private readonly clock: Clock = systemClock) {
    this.environment = parseRuntimeEnvironment(environment);
  }

  private validateState(value: OperationModeState): OperationModeState {
    if (value.environment !== this.environment || !isOperationMode(value.mode) ||
      !Number.isSafeInteger(value.version) || value.version < 1 ||
      typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) ||
      !isSafeOperationMetadata(value.updatedBy, 128) || !isSafeOperationMetadata(value.reason, 512)) {
      throw new OperationModeUnavailableError("invalid_state");
    }
    return { environment: value.environment, mode: value.mode, version: value.version,
      updatedAt: value.updatedAt, updatedBy: value.updatedBy, reason: value.reason };
  }

  private async execute(statement: D1PreparedStatement): Promise<OperationModeState | null> {
    try {
      const row = await statement.first<OperationModeState>();
      return row === null ? null : this.validateState(row);
    } catch (error) {
      if (error instanceof OperationModeUnavailableError) throw error;
      throw new OperationModeUnavailableError("dependency_failure");
    }
  }

  async read(): Promise<OperationModeState> {
    try {
      const state = await this.execute(this.db.prepare(`SELECT ${columns} FROM operation_modes WHERE environment = ?`).bind(this.environment));
      if (!state) throw new OperationModeUnavailableError("missing");
      return state;
    } catch (error) {
      if (error instanceof OperationModeUnavailableError) throw error;
      throw new OperationModeUnavailableError("dependency_failure");
    }
  }

  async update(input: OperationModeUpdate): Promise<OperationModeUpdateResult> {
    if (!isOperationMode(input.mode) || !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0 || input.expectedVersion >= Number.MAX_SAFE_INTEGER ||
      !isSafeOperationMetadata(input.updatedBy, 128) || !isSafeOperationMetadata(input.reason, 512)) {
      throw new TypeError("Operation mode update is invalid");
    }
    const now = this.clock.now();
    if (!Number.isFinite(now.getTime())) throw new TypeError("Operation mode clock is invalid");
    const updatedAt = now.toISOString();
    try {
      const statement = input.expectedVersion === 0
        ? this.db.prepare(`INSERT INTO operation_modes(environment, mode, version, updated_at, updated_by, reason)
            VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT(environment) DO NOTHING RETURNING ${columns}`)
          .bind(this.environment, input.mode, updatedAt, input.updatedBy, input.reason)
        : this.db.prepare(`UPDATE operation_modes SET mode = ?, version = version + 1,
            updated_at = ?, updated_by = ?, reason = ? WHERE environment = ? AND version = ? RETURNING ${columns}`)
          .bind(input.mode, updatedAt, input.updatedBy, input.reason, this.environment, input.expectedVersion);
      const state = await this.execute(statement);
      return state ? { kind: "updated", state } : { kind: "conflict" };
    } catch (error) {
      if (error instanceof OperationModeUnavailableError) throw error;
      throw new OperationModeUnavailableError("dependency_failure");
    }
  }
}
