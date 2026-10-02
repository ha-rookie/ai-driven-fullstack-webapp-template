export type OperationBudgetRequestKind = "foreground" | "background";

export type OperationBudgetSnapshot = {
  actionId: string;
  httpRequests: number;
  backgroundRequests: number;
  duplicateRequests: number;
  d1Statements: number;
  d1Failures: number;
  rowsRead: number | null;
  rowsWritten: number | null;
  metadataUnavailableEvents: number;
};

export type D1OperationMeasurement = {
  statements?: number;
  rowsRead?: number | null;
  rowsWritten?: number | null;
  failed?: boolean;
};

export type OperationBudgetThresholds = {
  maxHttpRequests?: number;
  maxD1Statements?: number;
  maxRowsRead?: number;
  maxRowsWritten?: number;
  expectedActionsPerDay?: number;
};

export type OperationBudgetAssessment = {
  ok: boolean;
  failures: string[];
  dailyForecast: {
    actions: number;
    httpRequests: number;
    d1Statements: number;
    rowsRead: number | null;
    rowsWritten: number | null;
  } | null;
};

const safeCount = (value: number | undefined, fallback = 0) => {
  const count = value ?? fallback;
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("operation budget count must be a non-negative safe integer");
  return count;
};

const safeMetric = (value: number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) throw new TypeError("operation budget metric must be a non-negative finite number");
  return value;
};

export class OperationBudgetRecorder {
  private actionId: string;
  private httpRequests = 0;
  private backgroundRequests = 0;
  private duplicateRequests = 0;
  private d1Statements = 0;
  private d1Failures = 0;
  private rowsRead = 0;
  private rowsWritten = 0;
  private rowsReadKnown = true;
  private rowsWrittenKnown = true;
  private metadataUnavailableEvents = 0;

  constructor(actionId: string) {
    this.actionId = OperationBudgetRecorder.validateActionId(actionId);
  }

  private static validateActionId(actionId: string) {
    const value = actionId.trim();
    if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/i.test(value)) throw new TypeError("operation budget actionId is invalid");
    return value;
  }

  reset(actionId = this.actionId) {
    this.actionId = OperationBudgetRecorder.validateActionId(actionId);
    this.httpRequests = 0;
    this.backgroundRequests = 0;
    this.duplicateRequests = 0;
    this.d1Statements = 0;
    this.d1Failures = 0;
    this.rowsRead = 0;
    this.rowsWritten = 0;
    this.rowsReadKnown = true;
    this.rowsWrittenKnown = true;
    this.metadataUnavailableEvents = 0;
  }

  recordHttpRequest(kind: OperationBudgetRequestKind = "foreground", duplicate = false) {
    this.httpRequests += 1;
    if (kind === "background") this.backgroundRequests += 1;
    if (duplicate) this.duplicateRequests += 1;
  }

  recordD1(measurement: D1OperationMeasurement = {}) {
    this.d1Statements += safeCount(measurement.statements, 1);
    if (measurement.failed) this.d1Failures += 1;

    const read = safeMetric(measurement.rowsRead);
    const written = safeMetric(measurement.rowsWritten);
    if (read === null || written === null) this.metadataUnavailableEvents += 1;
    if (read === null) this.rowsReadKnown = false;
    else this.rowsRead += read;
    if (written === null) this.rowsWrittenKnown = false;
    else this.rowsWritten += written;
  }

  snapshot(): OperationBudgetSnapshot {
    return Object.freeze({
      actionId: this.actionId,
      httpRequests: this.httpRequests,
      backgroundRequests: this.backgroundRequests,
      duplicateRequests: this.duplicateRequests,
      d1Statements: this.d1Statements,
      d1Failures: this.d1Failures,
      rowsRead: this.rowsReadKnown ? this.rowsRead : null,
      rowsWritten: this.rowsWrittenKnown ? this.rowsWritten : null,
      metadataUnavailableEvents: this.metadataUnavailableEvents,
    });
  }
}

const validateThreshold = (name: string, value: number | undefined) => {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative finite number`);
  return value;
};

export function assessOperationBudget(snapshot: OperationBudgetSnapshot, thresholds: OperationBudgetThresholds): OperationBudgetAssessment {
  const failures: string[] = [];
  const maxHttp = validateThreshold("maxHttpRequests", thresholds.maxHttpRequests);
  const maxStatements = validateThreshold("maxD1Statements", thresholds.maxD1Statements);
  const maxRead = validateThreshold("maxRowsRead", thresholds.maxRowsRead);
  const maxWritten = validateThreshold("maxRowsWritten", thresholds.maxRowsWritten);

  if (maxHttp !== null && snapshot.httpRequests > maxHttp) failures.push(`httpRequests ${snapshot.httpRequests} > ${maxHttp}`);
  if (maxStatements !== null && snapshot.d1Statements > maxStatements) failures.push(`d1Statements ${snapshot.d1Statements} > ${maxStatements}`);
  if (maxRead !== null) {
    if (snapshot.rowsRead === null) failures.push("rowsRead unavailable");
    else if (snapshot.rowsRead > maxRead) failures.push(`rowsRead ${snapshot.rowsRead} > ${maxRead}`);
  }
  if (maxWritten !== null) {
    if (snapshot.rowsWritten === null) failures.push("rowsWritten unavailable");
    else if (snapshot.rowsWritten > maxWritten) failures.push(`rowsWritten ${snapshot.rowsWritten} > ${maxWritten}`);
  }

  const actions = thresholds.expectedActionsPerDay === undefined ? null : safeCount(thresholds.expectedActionsPerDay);
  const dailyForecast = actions === null ? null : {
    actions,
    httpRequests: snapshot.httpRequests * actions,
    d1Statements: snapshot.d1Statements * actions,
    rowsRead: snapshot.rowsRead === null ? null : snapshot.rowsRead * actions,
    rowsWritten: snapshot.rowsWritten === null ? null : snapshot.rowsWritten * actions,
  };

  return { ok: failures.length === 0, failures, dailyForecast };
}

export function diffOperationBudget(current: OperationBudgetSnapshot, baseline: OperationBudgetSnapshot) {
  const delta = (value: number | null, previous: number | null) => value === null || previous === null ? null : value - previous;
  return {
    actionId: current.actionId,
    httpRequests: current.httpRequests - baseline.httpRequests,
    backgroundRequests: current.backgroundRequests - baseline.backgroundRequests,
    duplicateRequests: current.duplicateRequests - baseline.duplicateRequests,
    d1Statements: current.d1Statements - baseline.d1Statements,
    d1Failures: current.d1Failures - baseline.d1Failures,
    rowsRead: delta(current.rowsRead, baseline.rowsRead),
    rowsWritten: delta(current.rowsWritten, baseline.rowsWritten),
  };
}
