import { redactLogValue } from "../../shared/logging/redaction";
import { systemClock } from "../../shared/runtime";
import { isRuntimeEnvironment } from "../../shared/runtime";
import { isOperationMode, isSafeOperationMetadata } from "../../domain/operation-mode";
import type {
  AuditEvent,
  AuditLogger,
  StructuredAuditRecord,
} from "./types";

export type AuditLineWriter = (line: string) => void;
export type AuditClock = () => Date;

export const toStructuredAuditRecord = (
  event: AuditEvent,
  timestamp: string,
): StructuredAuditRecord => {
  const record: StructuredAuditRecord = {
    kind: "audit",
    timestamp,
    category: event.category,
    action: event.action,
    outcome: event.outcome,
    requestId: event.requestId,
    method: event.method,
    path: event.path,
  };

  if (event.actorId !== undefined) {
    Object.assign(record, { actorId: event.actorId });
  }
  if (event.scopeId !== undefined) {
    Object.assign(record, { scopeId: event.scopeId });
  }
  if (event.resourceType !== undefined) {
    Object.assign(record, { resourceType: event.resourceType });
  }
  if (event.resourceId !== undefined) {
    Object.assign(record, { resourceId: event.resourceId });
  }
  if (event.reason !== undefined) {
    Object.assign(record, { reason: event.reason });
  }
  if (
    event.affectedCount !== undefined &&
    Number.isSafeInteger(event.affectedCount) &&
    event.affectedCount >= 0
  ) {
    Object.assign(record, { affectedCount: event.affectedCount });
  }

  const change = event.operationModeChange;
  if (change && isRuntimeEnvironment(change.environment) &&
    isOperationMode(change.beforeMode) && isOperationMode(change.afterMode) &&
    Number.isSafeInteger(change.beforeVersion) && change.beforeVersion >= 1 &&
    Number.isSafeInteger(change.afterVersion) && change.afterVersion === change.beforeVersion + 1 &&
    isSafeOperationMetadata(change.reason, 200)) {
    Object.assign(record, { operationModeChange: {
      environment: change.environment, beforeMode: change.beforeMode, afterMode: change.afterMode,
      beforeVersion: change.beforeVersion, afterVersion: change.afterVersion, reason: change.reason,
    } });
  }

  return record;
};

export class ConsoleAuditLogger implements AuditLogger {
  constructor(
    private readonly writeLine: AuditLineWriter = (line) => console.info(line),
    private readonly now: AuditClock = () => systemClock.now(),
  ) {}

  write(event: AuditEvent): void {
    const record = toStructuredAuditRecord(event, this.now().toISOString());
    // Explicit Audit field projection remains in force before shared redaction.
    // Never pass the caller's AuditEvent directly to JSON.stringify.
    this.writeLine(JSON.stringify(redactLogValue(record)));
  }
}

export const consoleAuditLogger = new ConsoleAuditLogger();

export const writeAuditSafely = (
  logger: AuditLogger,
  event: AuditEvent,
): void => {
  try {
    logger.write(event);
  } catch {
    // Audit is best-effort in the baseline. Logging failure must not break Core behavior.
  }
};
