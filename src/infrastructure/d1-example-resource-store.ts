import {
  canTransitionExampleResource,
  isTerminalExampleResourceStatus,
  type ExampleResource,
  type ExampleResourceStatus,
} from "../domain/example-resource";

export type IntegrityFailureReason =
  | "not_found"
  | "stale"
  | "immutable"
  | "state_changed"
  | "invalid_transition";

export type IntegrityMutationResult =
  | { ok: true; resource: ExampleResource }
  | { ok: false; reason: IntegrityFailureReason; current: ExampleResource | null };

interface ExampleResourceRow {
  id: string;
  name: string;
  status: ExampleResourceStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const mapRow = (row: ExampleResourceRow): ExampleResource => ({
  id: row.id,
  name: row.name,
  status: row.status,
  version: Number(row.version),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const changedRows = (result: D1Result<unknown>): number => Number(result.meta?.changes ?? 0);

export const loadExampleResource = async (
  db: D1Database,
  id: string,
): Promise<ExampleResource | null> => {
  const row = await db
    .prepare(
      `SELECT id, name, status, version,
              created_at AS createdAt, updated_at AS updatedAt
         FROM example_resources
        WHERE id = ?`,
    )
    .bind(id)
    .first<ExampleResourceRow>();

  return row ? mapRow(row) : null;
};

const classifyMutationFailure = async (
  db: D1Database,
  id: string,
  expectedVersion: number,
  expectedStatus?: ExampleResourceStatus,
): Promise<IntegrityMutationResult> => {
  const current = await loadExampleResource(db, id);

  if (!current) {
    return { ok: false, reason: "not_found", current: null };
  }

  if (current.version !== expectedVersion) {
    return { ok: false, reason: "stale", current };
  }

  if (isTerminalExampleResourceStatus(current.status)) {
    return { ok: false, reason: "immutable", current };
  }

  if (expectedStatus && current.status !== expectedStatus) {
    return { ok: false, reason: "state_changed", current };
  }

  return { ok: false, reason: "state_changed", current };
};

const completeSuccessfulMutation = async (
  db: D1Database,
  id: string,
): Promise<IntegrityMutationResult> => {
  const resource = await loadExampleResource(db, id);
  if (!resource) {
    throw new Error("runtime_integrity_resource_missing_after_mutation");
  }
  return { ok: true, resource };
};

export const renameExampleResource = async (
  db: D1Database,
  input: {
    id: string;
    name: string;
    expectedVersion: number;
    changedAt: string;
  },
): Promise<IntegrityMutationResult> => {
  const nextVersion = input.expectedVersion + 1;

  const [updateResult, changeResult] = await db.batch([
    db
      .prepare(
        `UPDATE example_resources
            SET name = ?, updated_at = ?, version = version + 1
          WHERE id = ?
            AND version = ?
            AND status <> 'finalized'`,
      )
      .bind(input.name, input.changedAt, input.id, input.expectedVersion),
    db
      .prepare(
        `INSERT INTO example_resource_changes(
           resource_id, version, change_kind, from_status, to_status, created_at
         )
         SELECT id, version, 'rename', NULL, NULL, ?
           FROM example_resources
          WHERE id = ?
            AND version = ?
            AND NOT EXISTS (
              SELECT 1
                FROM example_resource_changes
               WHERE resource_id = ? AND version = ?
            )`,
      )
      .bind(input.changedAt, input.id, nextVersion, input.id, nextVersion),
  ]);

  const updated = changedRows(updateResult);
  const recorded = changedRows(changeResult);

  if (updated === 1 && recorded === 1) {
    return completeSuccessfulMutation(db, input.id);
  }

  if (updated !== recorded) {
    throw new Error("runtime_integrity_batch_mismatch");
  }

  return classifyMutationFailure(db, input.id, input.expectedVersion);
};

export const transitionExampleResourceStatus = async (
  db: D1Database,
  input: {
    id: string;
    fromStatus: ExampleResourceStatus;
    toStatus: ExampleResourceStatus;
    expectedVersion: number;
    changedAt: string;
  },
): Promise<IntegrityMutationResult> => {
  if (!canTransitionExampleResource(input.fromStatus, input.toStatus)) {
    return { ok: false, reason: "invalid_transition", current: null };
  }

  const nextVersion = input.expectedVersion + 1;

  const [updateResult, changeResult] = await db.batch([
    db
      .prepare(
        `UPDATE example_resources
            SET status = ?, updated_at = ?, version = version + 1
          WHERE id = ?
            AND version = ?
            AND status = ?
            AND status <> 'finalized'`,
      )
      .bind(
        input.toStatus,
        input.changedAt,
        input.id,
        input.expectedVersion,
        input.fromStatus,
      ),
    db
      .prepare(
        `INSERT INTO example_resource_changes(
           resource_id, version, change_kind, from_status, to_status, created_at
         )
         SELECT id, version, 'status_transition', ?, ?, ?
           FROM example_resources
          WHERE id = ?
            AND version = ?
            AND status = ?
            AND NOT EXISTS (
              SELECT 1
                FROM example_resource_changes
               WHERE resource_id = ? AND version = ?
            )`,
      )
      .bind(
        input.fromStatus,
        input.toStatus,
        input.changedAt,
        input.id,
        nextVersion,
        input.toStatus,
        input.id,
        nextVersion,
      ),
  ]);

  const updated = changedRows(updateResult);
  const recorded = changedRows(changeResult);

  if (updated === 1 && recorded === 1) {
    return completeSuccessfulMutation(db, input.id);
  }

  if (updated !== recorded) {
    throw new Error("runtime_integrity_batch_mismatch");
  }

  return classifyMutationFailure(
    db,
    input.id,
    input.expectedVersion,
    input.fromStatus,
  );
};
