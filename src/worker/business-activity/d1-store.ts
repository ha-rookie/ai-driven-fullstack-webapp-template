import type {
  BusinessActivityMetadata,
  BusinessActivityRecord,
  BusinessActivityStore,
  BusinessActivityStoreListQuery,
  BusinessActivityStorePage,
} from "./types";

interface BusinessActivityRow {
  id: string;
  environment: string;
  resource_type: string;
  resource_id: string;
  activity_type: string;
  actor_ref: string | null;
  actor_display_snapshot: string | null;
  subject_ref: string | null;
  source_type: string;
  source_id: string;
  source_sequence: number;
  visibility_scope: string | null;
  metadata_json: string;
  occurred_at: string;
  created_at: string;
}

const changesOf = (result: D1Result<unknown>): number =>
  typeof result.meta?.changes === "number" ? result.meta.changes : 0;

const isConstraintError = (error: unknown): boolean =>
  error instanceof Error && /UNIQUE constraint failed|constraint failed/iu.test(error.message);

const mapRow = (row: BusinessActivityRow): BusinessActivityRecord => ({
  id: row.id,
  environment: row.environment,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  activityType: row.activity_type,
  actorRef: row.actor_ref,
  actorDisplaySnapshot: row.actor_display_snapshot,
  subjectRef: row.subject_ref,
  sourceType: row.source_type,
  sourceId: row.source_id,
  sequence: row.source_sequence,
  visibilityScope: row.visibility_scope,
  metadata: JSON.parse(row.metadata_json) as BusinessActivityMetadata,
  occurredAt: row.occurred_at,
  createdAt: row.created_at,
});

export class D1BusinessActivityStore implements BusinessActivityStore {
  constructor(private readonly db: D1Database) {}

  async append(record: BusinessActivityRecord): Promise<"created" | "duplicate"> {
    try {
      const result = await this.db.prepare(`
        INSERT INTO business_activities (
          id, environment, resource_type, resource_id, activity_type,
          actor_ref, actor_display_snapshot, subject_ref,
          source_type, source_id, source_sequence, visibility_scope,
          metadata_json, occurred_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.id,
        record.environment,
        record.resourceType,
        record.resourceId,
        record.activityType,
        record.actorRef,
        record.actorDisplaySnapshot,
        record.subjectRef,
        record.sourceType,
        record.sourceId,
        record.sequence,
        record.visibilityScope,
        JSON.stringify(record.metadata),
        record.occurredAt,
        record.createdAt,
      ).run();
      return changesOf(result) === 1 ? "created" : "duplicate";
    } catch (error) {
      if (isConstraintError(error)) return "duplicate";
      throw error;
    }
  }

  async list(query: BusinessActivityStoreListQuery): Promise<BusinessActivityStorePage> {
    const clauses = ["environment = ?", "resource_type = ?", "resource_id = ?"];
    const bindings: unknown[] = [query.environment, query.resourceType, query.resourceId];

    if (query.cursor) {
      clauses.push(`(
        occurred_at < ?
        OR (occurred_at = ? AND source_sequence < ?)
        OR (occurred_at = ? AND source_sequence = ? AND id < ?)
      )`);
      bindings.push(
        query.cursor.occurredAt,
        query.cursor.occurredAt,
        query.cursor.sequence,
        query.cursor.occurredAt,
        query.cursor.sequence,
        query.cursor.id,
      );
    }

    if (query.activityTypes?.length) {
      clauses.push(`activity_type IN (${query.activityTypes.map(() => "?").join(", ")})`);
      bindings.push(...query.activityTypes);
    }

    bindings.push(query.limit + 1);
    const result = await this.db.prepare(`
      SELECT id, environment, resource_type, resource_id, activity_type,
             actor_ref, actor_display_snapshot, subject_ref,
             source_type, source_id, source_sequence, visibility_scope,
             metadata_json, occurred_at, created_at
      FROM business_activities
      WHERE ${clauses.join(" AND ")}
      ORDER BY occurred_at DESC, source_sequence DESC, id DESC
      LIMIT ?
    `).bind(...bindings).all<BusinessActivityRow>();

    const rows = result.results ?? [];
    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit).map(mapRow);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? { occurredAt: last.occurredAt, sequence: last.sequence, id: last.id }
        : null,
    };
  }
}
