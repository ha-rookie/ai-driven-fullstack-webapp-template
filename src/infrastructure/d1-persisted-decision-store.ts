export interface PersistedDecision {
  resourceId: string;
  sourceSnapshot: string;
  decisionValue: string;
  ruleVersion: string;
  decisionVersion: number;
  decidedAt: string;
  decidedBy: string;
}

export interface DecisionEvaluator {
  decide(input: { sourceSnapshot: string; ruleVersion: string }): string;
}

interface PersistedDecisionRow {
  resourceId: string;
  sourceSnapshot: string;
  decisionValue: string;
  ruleVersion: string;
  decisionVersion: number;
  decidedAt: string;
  decidedBy: string;
}

const changedRows = (result: D1Result<unknown>): number => Number(result.meta?.changes ?? 0);

const bounded = (value: string, name: string, max: number): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${name} must be between 1 and ${max} characters`);
  }
  return normalized;
};

const mapRow = (row: PersistedDecisionRow): PersistedDecision => ({
  resourceId: row.resourceId,
  sourceSnapshot: row.sourceSnapshot,
  decisionValue: row.decisionValue,
  ruleVersion: row.ruleVersion,
  decisionVersion: Number(row.decisionVersion),
  decidedAt: row.decidedAt,
  decidedBy: row.decidedBy,
});

export const loadPersistedDecision = async (
  db: D1Database,
  resourceId: string,
): Promise<PersistedDecision | null> => {
  const id = bounded(resourceId, "resourceId", 128);
  const row = await db
    .prepare(
      `SELECT resource_id AS resourceId,
              source_snapshot AS sourceSnapshot,
              decision_value AS decisionValue,
              rule_version AS ruleVersion,
              decision_version AS decisionVersion,
              decided_at AS decidedAt,
              decided_by AS decidedBy
         FROM example_resource_decisions
        WHERE resource_id = ?`,
    )
    .bind(id)
    .first<PersistedDecisionRow>();

  return row ? mapRow(row) : null;
};

export const createPersistedDecision = async (
  db: D1Database,
  evaluator: DecisionEvaluator,
  input: {
    resourceId: string;
    sourceSnapshot: string;
    ruleVersion: string;
    decidedAt: string;
    decidedBy: string;
  },
): Promise<PersistedDecision> => {
  const resourceId = bounded(input.resourceId, "resourceId", 128);
  const sourceSnapshot = bounded(input.sourceSnapshot, "sourceSnapshot", 4096);
  const ruleVersion = bounded(input.ruleVersion, "ruleVersion", 128);
  const decidedBy = bounded(input.decidedBy, "decidedBy", 128);
  const decisionValue = bounded(
    evaluator.decide({ sourceSnapshot, ruleVersion }),
    "decisionValue",
    256,
  );

  const result = await db
    .prepare(
      `INSERT INTO example_resource_decisions(
         resource_id, source_snapshot, decision_value, rule_version,
         decision_version, decided_at, decided_by
       ) VALUES(?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(resourceId, sourceSnapshot, decisionValue, ruleVersion, input.decidedAt, decidedBy)
    .run();

  if (changedRows(result) !== 1) throw new Error("persisted_decision_create_failed");
  const created = await loadPersistedDecision(db, resourceId);
  if (!created) throw new Error("persisted_decision_missing_after_create");
  return created;
};

export type CorrectPersistedDecisionResult =
  | { ok: true; decision: PersistedDecision }
  | { ok: false; reason: "not_found" | "stale"; current: PersistedDecision | null };

export const correctPersistedDecision = async (
  db: D1Database,
  evaluator: DecisionEvaluator,
  input: {
    resourceId: string;
    sourceSnapshot: string;
    ruleVersion: string;
    expectedDecisionVersion: number;
    decidedAt: string;
    decidedBy: string;
  },
): Promise<CorrectPersistedDecisionResult> => {
  if (!Number.isInteger(input.expectedDecisionVersion) || input.expectedDecisionVersion < 1) {
    throw new TypeError("expectedDecisionVersion must be a positive integer");
  }

  const resourceId = bounded(input.resourceId, "resourceId", 128);
  const sourceSnapshot = bounded(input.sourceSnapshot, "sourceSnapshot", 4096);
  const ruleVersion = bounded(input.ruleVersion, "ruleVersion", 128);
  const decidedBy = bounded(input.decidedBy, "decidedBy", 128);
  const decisionValue = bounded(
    evaluator.decide({ sourceSnapshot, ruleVersion }),
    "decisionValue",
    256,
  );

  const result = await db
    .prepare(
      `UPDATE example_resource_decisions
          SET source_snapshot = ?,
              decision_value = ?,
              rule_version = ?,
              decision_version = decision_version + 1,
              decided_at = ?,
              decided_by = ?
        WHERE resource_id = ?
          AND decision_version = ?`,
    )
    .bind(
      sourceSnapshot,
      decisionValue,
      ruleVersion,
      input.decidedAt,
      decidedBy,
      resourceId,
      input.expectedDecisionVersion,
    )
    .run();

  if (changedRows(result) === 1) {
    const updated = await loadPersistedDecision(db, resourceId);
    if (!updated) throw new Error("persisted_decision_missing_after_correction");
    return { ok: true, decision: updated };
  }

  const current = await loadPersistedDecision(db, resourceId);
  if (!current) return { ok: false, reason: "not_found", current: null };
  return { ok: false, reason: "stale", current };
};
