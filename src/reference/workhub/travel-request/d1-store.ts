import type {
  TravelRequestCompareAndSetOptions,
  TravelRequestListItem,
  TravelRequestRecord,
  TravelRequestStore,
} from "./types";

interface TravelRequestRow {
  id: string;
  environment: string;
  requester_id: string;
  destination_office_item_id: string;
  destination_office_revision_id: string | null;
  start_date: string;
  end_date: string;
  purpose: string;
  status: TravelRequestRecord["status"];
  submission_key: string | null;
  workflow_instance_id: string | null;
  submitted_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

const changesOf = (result: D1Result<unknown>): number =>
  typeof result.meta?.changes === "number" ? result.meta.changes : 0;

const isConstraintError = (error: unknown): boolean =>
  error instanceof Error && /UNIQUE constraint failed|constraint failed/iu.test(error.message);

const mapRow = (row: TravelRequestRow): TravelRequestRecord => ({
  id: row.id,
  environment: row.environment,
  requesterId: row.requester_id,
  destinationOfficeItemId: row.destination_office_item_id,
  destinationOfficeRevisionId: row.destination_office_revision_id,
  startDate: row.start_date,
  endDate: row.end_date,
  purpose: row.purpose,
  status: row.status,
  submissionKey: row.submission_key,
  workflowInstanceId: row.workflow_instance_id,
  submittedAt: row.submitted_at,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class D1TravelRequestStore implements TravelRequestStore {
  constructor(private readonly db: D1Database) {}

  async create(record: TravelRequestRecord): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        INSERT INTO reference_travel_requests (
          id, environment, requester_id, destination_office_item_id,
          destination_office_revision_id, start_date, end_date, purpose, status,
          submission_key, workflow_instance_id, submitted_at, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        record.id,
        record.environment,
        record.requesterId,
        record.destinationOfficeItemId,
        record.destinationOfficeRevisionId,
        record.startDate,
        record.endDate,
        record.purpose,
        record.status,
        record.submissionKey,
        record.workflowInstanceId,
        record.submittedAt,
        record.version,
        record.createdAt,
        record.updatedAt,
      ).run();
      return changesOf(result) === 1;
    } catch (error) {
      if (isConstraintError(error)) return false;
      throw error;
    }
  }

  async get(id: string, environment: string): Promise<TravelRequestRecord | null> {
    const row = await this.db.prepare(`
      SELECT id, environment, requester_id, destination_office_item_id,
             destination_office_revision_id, start_date, end_date, purpose, status,
             submission_key, workflow_instance_id, submitted_at, version, created_at, updated_at
      FROM reference_travel_requests
      WHERE id = ? AND environment = ?
    `).bind(id, environment).first<TravelRequestRow>();
    return row ? mapRow(row) : null;
  }

  async listOwned(environment: string, requesterId: string, limit: number): Promise<readonly TravelRequestListItem[]> {
    // A single bounded read: owner/environment filtering stays in D1. Join
    // only the matching workflow resource and owner, never another user's.
    // A missing workflow is UNKNOWN, not implicitly "approval pending".
    const rows = await this.db.prepare(`
      SELECT tr.id, tr.environment, tr.requester_id, tr.destination_office_item_id,
             tr.destination_office_revision_id, tr.start_date, tr.end_date,
             tr.purpose, tr.status, tr.submission_key, tr.workflow_instance_id,
             tr.submitted_at, tr.version, tr.created_at, tr.updated_at,
             wi.state AS workflow_state
      FROM reference_travel_requests tr
      LEFT JOIN workflow_instances wi
        ON wi.id = tr.workflow_instance_id
       AND wi.environment = tr.environment
       AND wi.resource_type = 'workhub.travel_request'
       AND wi.resource_id = tr.id
       AND wi.requester_id = tr.requester_id
      WHERE tr.environment = ? AND tr.requester_id = ?
      ORDER BY tr.updated_at DESC, tr.id DESC
      LIMIT ?
    `).bind(environment, requesterId, limit).all<TravelRequestRow & { workflow_state: TravelRequestListItem["workflowState"] }>();
    return (rows.results ?? []).map(row => ({ ...mapRow(row), workflowState: row.workflow_state }));
  }

  async compareAndSet(
    record: TravelRequestRecord,
    options: TravelRequestCompareAndSetOptions,
  ): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        UPDATE reference_travel_requests
        SET destination_office_item_id = ?, destination_office_revision_id = ?,
            start_date = ?, end_date = ?, purpose = ?, status = ?, submission_key = ?,
            workflow_instance_id = ?, submitted_at = ?, version = ?, updated_at = ?
        WHERE id = ? AND environment = ? AND version = ? AND status = ?
      `).bind(
        record.destinationOfficeItemId,
        record.destinationOfficeRevisionId,
        record.startDate,
        record.endDate,
        record.purpose,
        record.status,
        record.submissionKey,
        record.workflowInstanceId,
        record.submittedAt,
        record.version,
        record.updatedAt,
        record.id,
        record.environment,
        options.expectedVersion,
        options.expectedStatus,
      ).run();
      return changesOf(result) === 1;
    } catch (error) {
      if (isConstraintError(error)) return false;
      throw error;
    }
  }
}
