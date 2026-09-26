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

  return record;
};

export class ConsoleAuditLogger implements AuditLogger {
  constructor(
    private readonly writeLine: AuditLineWriter = (line) => console.info(line),
    private readonly now: AuditClock = () => new Date(),
  ) {}

  write(event: AuditEvent): void {
    const record = toStructuredAuditRecord(event, this.now().toISOString());
    this.writeLine(JSON.stringify(record));
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
