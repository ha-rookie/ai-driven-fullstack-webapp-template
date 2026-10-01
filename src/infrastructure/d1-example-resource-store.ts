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
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

const normalizeActorId = (actorId: string): string => {
  const normalized = actorId.trim();
  if (!normalized || normalized.length > 128) {
    throw new TypeError("actorId must be between 1 and 128 characters");
  }
  return normalized;
};

const mapRow = (row: ExampleResourceRow): ExampleResource => ({
  id: row.id,
  name: row.name,
  status: row.status,
  version: Number(row.version),
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy,
});

const changedRows = (result: D1Result<unknown>): number => Number(result.meta?.changes ?? 0);

export const loadExampleResource = async (
  db: D1Database,
  id: string,
): Promise<ExampleResource | null> => {
  const row = await db
    .prepare(
      `SELECT id, name, status, version,
              created_at AS createdAt, created_by AS createdBy,
              updated_at AS updatedAt, updated_by AS updatedBy
         FROM example_resources
        WHERE id = ?`,
    )
    .bind(id)
    .first<ExampleResourceRow>();

  return row ? mapRow(row) : null;
};

export const createExampleResource = async (
  db: D1Database,
  input: {
    id: string;
    name: string;
    actorId: string;
    createdAt: string;
  },
): Promise<ExampleResource> => {
  const actorId = normalizeActorId(input.actorId);
  const result = await db
    .prepare(
      `INSERT INTO example_resources(
         id, name, status, version, created_at, created_by, updated_at, updated_by
       ) VALUES(?, ?, 'draft', 1, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.name,
      input.createdAt,
      actorId,
      input.createdAt,
      actorId,
    )
    .run();

  if (changedRows(result) !== 1) {
    throw new Error("example_resource_create_failed");
  }

  const created = await loadExampleResource(db, input.id);
  if (!created) {
    throw new Error("example_resource_missing_after_create");
  }
  return created;
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
    actorId: string;
  },
): Promise<IntegrityMutationResult> => {
  const actorId = normalizeActorId(input.actorId);
  const nextVersion = input.expectedVersion + 1;

  const [updateResult, changeResult] = await db.batch([
    db
      .prepare(
        `UPDATE example_resources
            SET name = ?, updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ?
            AND version = ?
            AND status <> 'finalized'`,
      )
      .bind(input.name, input.changedAt, actorId, input.id, input.expectedVersion),
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
    actorId: string;
  },
): Promise<IntegrityMutationResult> => {
  if (!canTransitionExampleResource(input.fromStatus, input.toStatus)) {
    return { ok: false, reason: "invalid_transition", current: null };
  }

  const actorId = normalizeActorId(input.actorId);
  const nextVersion = input.expectedVersion + 1;

  const [updateResult, changeResult] = await db.batch([
    db
      .prepare(
        `UPDATE example_resources
            SET status = ?, updated_at = ?, updated_by = ?, version = version + 1
          WHERE id = ?
            AND version = ?
            AND status = ?
            AND status <> 'finalized'`,
      )
      .bind(
        input.toStatus,
        input.changedAt,
        actorId,
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
