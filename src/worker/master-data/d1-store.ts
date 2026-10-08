import type { PreparedDurableAuditRecord } from "../audit/durable-audit-store";
import type {
  AppendMasterRevisionBundle,
  CreateMasterItemBundle,
  MasterDataStore,
  MasterItemRecord,
  MasterRevisionRecord,
  ResolvedMasterValue,
  RetireMasterItemBundle,
  ScheduleMasterRevisionBundle,
} from "./types";

interface MasterItemRow {
  id: string;
  environment: string;
  master_key: string;
  code: string;
  version: number;
  next_revision: number;
  retired_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

interface MasterRevisionRow {
  id: string;
  environment: string;
  master_item_id: string;
  revision: number;
  label: string;
  enabled: number;
  effective_from: string;
  effective_to: string | null;
  display_order: number;
  parent_item_id: string | null;
  attributes_json: string;
  created_at: string;
  created_by: string;
}

const changesOf = (result: D1Result<unknown>): number =>
  typeof result.meta?.changes === "number" ? result.meta.changes : 0;

const isConstraintError = (error: unknown): boolean =>
  error instanceof Error && /constraint failed|UNIQUE constraint failed/iu.test(error.message);

const mapItem = (row: MasterItemRow): MasterItemRecord => ({
  id: row.id,
  environment: row.environment,
  masterKey: row.master_key,
  code: row.code,
  version: row.version,
  nextRevision: row.next_revision,
  retiredAt: row.retired_at,
  createdAt: row.created_at,
  createdBy: row.created_by,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
});

const mapRevision = (row: MasterRevisionRow): MasterRevisionRecord => ({
  id: row.id,
  environment: row.environment,
  masterItemId: row.master_item_id,
  revision: row.revision,
  label: row.label,
  enabled: row.enabled === 1,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  displayOrder: row.display_order,
  parentItemId: row.parent_item_id,
  attributes: JSON.parse(row.attributes_json) as unknown,
  createdAt: row.created_at,
  createdBy: row.created_by,
});

const itemColumns = `
  i.id, i.environment, i.master_key, i.code, i.version, i.next_revision,
  i.retired_at, i.created_at, i.created_by, i.updated_at, i.updated_by
`;

const revisionColumns = `
  r.id AS revision_id, r.environment AS revision_environment,
  r.master_item_id, r.revision, r.label, r.enabled, r.effective_from,
  r.effective_to, r.display_order, r.parent_item_id, r.attributes_json,
  r.created_at AS revision_created_at, r.created_by AS revision_created_by
`;

const mapResolved = (row: Record<string, unknown>): ResolvedMasterValue => {
  const item = mapItem({
    id: String(row.id),
    environment: String(row.environment),
    master_key: String(row.master_key),
    code: String(row.code),
    version: Number(row.version),
    next_revision: Number(row.next_revision),
    retired_at: row.retired_at == null ? null : String(row.retired_at),
    created_at: String(row.created_at),
    created_by: String(row.created_by),
    updated_at: String(row.updated_at),
    updated_by: String(row.updated_by),
  });
  const revision = mapRevision({
    id: String(row.revision_id),
    environment: String(row.revision_environment),
    master_item_id: String(row.master_item_id),
    revision: Number(row.revision),
    label: String(row.label),
    enabled: Number(row.enabled),
    effective_from: String(row.effective_from),
    effective_to: row.effective_to == null ? null : String(row.effective_to),
    display_order: Number(row.display_order),
    parent_item_id: row.parent_item_id == null ? null : String(row.parent_item_id),
    attributes_json: String(row.attributes_json),
    created_at: String(row.revision_created_at),
    created_by: String(row.revision_created_by),
  });
  return { item, revision };
};

export class MasterDataStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterDataStoreIntegrityError";
  }
}

/**
 * Pre-hashed audit proof is written inside the *same* D1 transaction.
 * A missing mutation marker nullifies the explicitly NOT NULL environment, forcing the batch
 * to roll back (zero-row conditional inserts alone do NOT roll back a batch).
 */
const prepareMasterAuditInsert = (
  db: D1Database,
  receipt: PreparedDurableAuditRecord,
  item: MasterItemRecord,
  mutationId: string,
): D1PreparedStatement => {
  if (receipt.environment !== item.environment
    || receipt.record.resourceId !== item.id
    || receipt.record.resourceType !== "master_item"
    || receipt.record.actorId !== item.updatedBy
    || receipt.record.outcome !== "success"
    || receipt.record.category !== "system"
    || !receipt.record.action.startsWith("operation.")) {
    throw new MasterDataStoreIntegrityError("master mutation audit metadata mismatch");
  }
  return db.prepare(`
    INSERT INTO durable_audit_events (
      id, environment, occurred_at, request_id, category, action, outcome,
      actor_id, scope_id, resource_type, resource_id, record_json, record_sha256, created_at
    )
    SELECT ?, CASE WHEN EXISTS (
      SELECT 1 FROM master_items i
      WHERE i.id = ? AND i.environment = ? AND i.last_mutation_id = ? AND i.version = ?
    ) THEN ? ELSE NULL END,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  `).bind(
    receipt.id, item.id, item.environment, mutationId, item.version,
    receipt.environment, receipt.occurredAt, receipt.record.requestId,
    receipt.record.category, receipt.record.action, receipt.record.outcome,
    receipt.record.actorId ?? null, receipt.record.scopeId ?? null,
    receipt.record.resourceType ?? null, receipt.record.resourceId ?? null,
    receipt.recordJson, receipt.recordSha256, receipt.occurredAt,
  );
};

export class D1MasterDataStore implements MasterDataStore {
  constructor(private readonly db: D1Database) {}

  async createItem(bundle: CreateMasterItemBundle): Promise<boolean> {
    const { item, mutationId } = bundle;
    try {
      const result = await this.db.prepare(`
        INSERT INTO master_items (
          id, environment, master_key, code, version, next_revision, last_mutation_id,
          retired_at, created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        item.id,
        item.environment,
        item.masterKey,
        item.code,
        item.version,
        item.nextRevision,
        mutationId,
        item.retiredAt,
        item.createdAt,
        item.createdBy,
        item.updatedAt,
        item.updatedBy,
      ).run();
      return changesOf(result) === 1;
    } catch (error) {
      if (isConstraintError(error)) return false;
      throw error;
    }
  }

  async getItem(itemId: string, environment: string): Promise<MasterItemRecord | null> {
    const row = await this.db.prepare(`
      SELECT id, environment, master_key, code, version, next_revision,
             retired_at, created_at, created_by, updated_at, updated_by
      FROM master_items
      WHERE id = ? AND environment = ?
    `).bind(itemId, environment).first<MasterItemRow>();
    return row ? mapItem(row) : null;
  }

  async getItemByCode(masterKey: string, code: string, environment: string): Promise<MasterItemRecord | null> {
    const row = await this.db.prepare(`
      SELECT id, environment, master_key, code, version, next_revision,
             retired_at, created_at, created_by, updated_at, updated_by
      FROM master_items
      WHERE environment = ? AND master_key = ? AND code = ?
    `).bind(environment, masterKey, code).first<MasterItemRow>();
    return row ? mapItem(row) : null;
  }

  async appendRevision(bundle: AppendMasterRevisionBundle): Promise<boolean> {
    const { item, revision, mutationId } = bundle;
    const nextTo = revision.effectiveTo;
    const itemUpdate = this.db.prepare(`
      UPDATE master_items
      SET version = ?, next_revision = ?, last_mutation_id = ?, updated_at = ?, updated_by = ?
      WHERE id = ? AND environment = ? AND version = ? AND retired_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM master_revisions r
          WHERE r.master_item_id = master_items.id
            AND r.environment = master_items.environment
            AND (? IS NULL OR r.effective_from < ?)
            AND (r.effective_to IS NULL OR ? < r.effective_to)
        )
    `).bind(
      item.version,
      item.nextRevision,
      mutationId,
      item.updatedAt,
      item.updatedBy,
      item.id,
      item.environment,
      bundle.expectedItemVersion,
      nextTo,
      nextTo,
      revision.effectiveFrom,
    );

    const revisionInsert = this.db.prepare(`
      INSERT INTO master_revisions (
        id, environment, master_item_id, revision, label, enabled,
        effective_from, effective_to, display_order, parent_item_id,
        attributes_json, created_at, created_by
      )
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM master_items i
        WHERE i.id = ? AND i.environment = ? AND i.last_mutation_id = ?
          AND i.version = ?
      ) THEN ? ELSE NULL END,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    `).bind(
      revision.id, item.id, item.environment, mutationId, item.version,
      revision.environment, revision.masterItemId, revision.revision,
      revision.label, revision.enabled ? 1 : 0, revision.effectiveFrom,
      revision.effectiveTo, revision.displayOrder, revision.parentItemId,
      JSON.stringify(revision.attributes), revision.createdAt, revision.createdBy,
    );

    try {
      const results = await this.db.batch([itemUpdate, revisionInsert]);
      if (results.length !== 2 || results.some((result) => changesOf(result) !== 1)) {
        throw new MasterDataStoreIntegrityError("master revision transaction returned unexpected result counts");
      }
      return true;
    } catch (error) {
      if (isConstraintError(error)) return false;
      throw error;
    }
  }

  async scheduleRevision(bundle: ScheduleMasterRevisionBundle): Promise<boolean> {
    const { item, revision, mutationId, priorRevisionId, expectedItemVersion } = bundle;
    if (revision.effectiveTo !== null || revision.revision !== item.nextRevision - 1
      || revision.environment !== item.environment || revision.masterItemId !== item.id) return false;

    // D1 batch is a single transaction: optimistic guard, close prior period, insert new period.
    // Other revisions may not extend into [effectiveFrom, +infinity).
    const itemUpdate = this.db.prepare(`
      UPDATE master_items
      SET version = ?, next_revision = ?, last_mutation_id = ?, updated_at = ?, updated_by = ?
      WHERE id = ? AND environment = ? AND version = ? AND retired_at IS NULL
        AND EXISTS (
          SELECT 1 FROM master_revisions prior
          WHERE prior.id = ? AND prior.master_item_id = master_items.id
            AND prior.environment = master_items.environment
            AND prior.effective_to IS NULL AND prior.effective_from < ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM master_revisions other
          WHERE other.master_item_id = master_items.id
            AND other.environment = master_items.environment AND other.id <> ?
            AND (other.effective_to IS NULL OR ? < other.effective_to)
        )
    `).bind(
      item.version, item.nextRevision, mutationId, item.updatedAt, item.updatedBy,
      item.id, item.environment, expectedItemVersion,
      priorRevisionId, revision.effectiveFrom, priorRevisionId, revision.effectiveFrom,
    );

    const closePrior = this.db.prepare(`
      UPDATE master_revisions SET effective_to = ?
      WHERE id = ? AND environment = ? AND master_item_id = ?
        AND effective_to IS NULL AND effective_from < ?
        AND EXISTS (
          SELECT 1 FROM master_items i
          WHERE i.id = master_revisions.master_item_id
            AND i.environment = master_revisions.environment AND i.last_mutation_id = ?
        )
    `).bind(
      revision.effectiveFrom, priorRevisionId, item.environment, item.id,
      revision.effectiveFrom, mutationId,
    );

    const nextInsert = this.db.prepare(`
      INSERT INTO master_revisions (
        id, environment, master_item_id, revision, label, enabled,
        effective_from, effective_to, display_order, parent_item_id,
        attributes_json, created_at, created_by
      )
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM master_items i
        JOIN master_revisions prior
          ON prior.master_item_id = i.id AND prior.environment = i.environment
        WHERE i.id = ? AND i.environment = ? AND i.last_mutation_id = ?
          AND i.version = ? AND prior.id = ? AND prior.effective_to = ?
      ) THEN ? ELSE NULL END,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    `).bind(
      revision.id, item.id, item.environment, mutationId, item.version,
      priorRevisionId, revision.effectiveFrom, revision.environment,
      revision.masterItemId, revision.revision,
      revision.label, revision.enabled ? 1 : 0, revision.effectiveFrom, null,
      revision.displayOrder, revision.parentItemId, JSON.stringify(revision.attributes),
      revision.createdAt, revision.createdBy,
    );
    const statements = [itemUpdate, closePrior, nextInsert];
    if (bundle.durableAudit) {
      statements.push(prepareMasterAuditInsert(this.db, bundle.durableAudit, item, mutationId));
    }

    try {
      const results = await this.db.batch(statements);
      if (results.length !== statements.length || results.some((result) => changesOf(result) !== 1)) {
        throw new MasterDataStoreIntegrityError("master cutover transaction returned unexpected result counts");
      }
      return true;
    } catch (error) {
      if (isConstraintError(error)) return false;
      throw error;
    }
  }

  async retireItem(bundle: RetireMasterItemBundle): Promise<boolean> {
    const { item, mutationId } = bundle;
    const update = this.db.prepare(`
      UPDATE master_items
      SET version = ?, last_mutation_id = ?, retired_at = ?, updated_at = ?, updated_by = ?
      WHERE id = ? AND environment = ? AND version = ? AND retired_at IS NULL
    `).bind(
      item.version,
      mutationId,
      item.retiredAt,
      item.updatedAt,
      item.updatedBy,
      item.id,
      item.environment,
      bundle.expectedItemVersion,
    );
    if (!bundle.durableAudit) {
      const result = await update.run();
      return changesOf(result) === 1;
    }
    const proof = prepareMasterAuditInsert(this.db, bundle.durableAudit, item, mutationId);
    try {
      const results = await this.db.batch([update, proof]);
      if (results.length !== 2 || results.some((result) => changesOf(result) !== 1)) {
        throw new MasterDataStoreIntegrityError("master retirement transaction returned unexpected result counts");
      }
      return true;
    } catch (error) {
      if (isConstraintError(error)) return false;
      throw error;
    }
  }

  async resolveAt(
    itemId: string,
    environment: string,
    asOf: string,
    options: { readonly includeDisabled?: boolean; readonly includeRetired?: boolean } = {},
  ): Promise<ResolvedMasterValue | null> {
    const row = await this.db.prepare(`
      SELECT ${itemColumns}, ${revisionColumns}
      FROM master_items i
      JOIN master_revisions r ON r.master_item_id = i.id AND r.environment = i.environment
      WHERE i.id = ? AND i.environment = ?
        AND r.effective_from <= ?
        AND (r.effective_to IS NULL OR ? < r.effective_to)
        AND (? = 1 OR r.enabled = 1)
        AND (? = 1 OR i.retired_at IS NULL OR ? < i.retired_at)
      ORDER BY r.effective_from DESC, r.revision DESC
      LIMIT 1
    `).bind(
      itemId,
      environment,
      asOf,
      asOf,
      options.includeDisabled === true ? 1 : 0,
      options.includeRetired === true ? 1 : 0,
      asOf,
    ).first<Record<string, unknown>>();
    return row ? mapResolved(row) : null;
  }

  async getRevisionById(revisionId: string, environment: string): Promise<ResolvedMasterValue | null> {
    const row = await this.db.prepare(`
      SELECT ${itemColumns}, ${revisionColumns}
      FROM master_revisions r
      JOIN master_items i ON i.id = r.master_item_id AND i.environment = r.environment
      WHERE r.id = ? AND r.environment = ?
      LIMIT 1
    `).bind(revisionId, environment).first<Record<string, unknown>>();
    return row ? mapResolved(row) : null;
  }

  async listSelectable(
    masterKey: string,
    environment: string,
    asOf: string,
    limit = 100,
  ): Promise<readonly ResolvedMasterValue[]> {
    const result = await this.db.prepare(`
      SELECT ${itemColumns}, ${revisionColumns}
      FROM master_items i
      JOIN master_revisions r ON r.master_item_id = i.id AND r.environment = i.environment
      WHERE i.environment = ? AND i.master_key = ?
        AND (i.retired_at IS NULL OR ? < i.retired_at)
        AND r.enabled = 1
        AND r.effective_from <= ?
        AND (r.effective_to IS NULL OR ? < r.effective_to)
      ORDER BY r.display_order ASC, r.label ASC, i.id ASC
      LIMIT ?
    `).bind(environment, masterKey, asOf, asOf, asOf, limit).all<Record<string, unknown>>();
    return (result.results ?? []).map(mapResolved);
  }
}
