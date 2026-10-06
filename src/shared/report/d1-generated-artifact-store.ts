import type { GeneratedArtifact } from "./report";
import type { GeneratedArtifactStore } from "./artifact-service";

interface GeneratedArtifactRow {
  id: string; environment: string; report_key: string; definition_version: string;
  template_key: string; template_version: string; resource_type: string; resource_id: string;
  source_snapshot_id: string; generation_intent: GeneratedArtifact["generationIntent"];
  output_type: GeneratedArtifact["outputType"]; object_identifier: string; content_type: string;
  byte_length: number | null; requested_at: string; generated_at: string | null; generated_by: string; status: GeneratedArtifact["status"]; version: number; failure_code: string | null; expires_at: string | null;
}

const mapRow = (row: GeneratedArtifactRow): GeneratedArtifact => Object.freeze({
  id: row.id, environment: row.environment, reportKey: row.report_key, definitionVersion: row.definition_version,
  templateKey: row.template_key, templateVersion: row.template_version, resourceType: row.resource_type,
  resourceId: row.resource_id, sourceSnapshotId: row.source_snapshot_id, generationIntent: row.generation_intent,
  outputType: row.output_type, objectIdentifier: row.object_identifier,
  ...(row.content_type === null ? {} : { contentType: row.content_type }), ...(row.byte_length === null ? {} : { byteLength: row.byte_length }), requestedAt: row.requested_at,
  ...(row.generated_at === null ? {} : { generatedAt: row.generated_at }), generatedBy: row.generated_by,
  status: row.status, version: row.version, ...(row.failure_code === null ? {} : { failureCode: row.failure_code }), ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
});

const isConstraintError = (error: unknown): boolean =>
  error instanceof Error && /UNIQUE constraint failed|constraint failed/iu.test(error.message);

export class D1GeneratedArtifactStore implements GeneratedArtifactStore {
  constructor(private readonly db: D1Database) {}

  async get(id: string, environment: string): Promise<GeneratedArtifact | null> {
    const row = await this.db.prepare(`
      SELECT id, environment, report_key, definition_version, template_key, template_version,
             resource_type, resource_id, source_snapshot_id, generation_intent, output_type,
             object_identifier, content_type, byte_length, requested_at, generated_at, generated_by, status, version, failure_code, expires_at
      FROM generated_artifacts WHERE environment = ? AND id = ? LIMIT 1
    `).bind(environment, id).first<GeneratedArtifactRow>();
    return row ? mapRow(row) : null;
  }

  async findOriginal(input: {
    environment: string; reportKey: string; resourceType: string; resourceId: string;
    sourceSnapshotId: string; outputType: GeneratedArtifact["outputType"];
  }): Promise<GeneratedArtifact | null> {
    const row = await this.db.prepare(`
      SELECT id, environment, report_key, definition_version, template_key, template_version,
             resource_type, resource_id, source_snapshot_id, generation_intent, output_type,
             object_identifier, content_type, byte_length, requested_at, generated_at, generated_by, status, version, failure_code, expires_at
      FROM generated_artifacts
      WHERE environment = ? AND report_key = ? AND resource_type = ? AND resource_id = ?
        AND source_snapshot_id = ? AND output_type = ? AND generation_intent = 'original'
      LIMIT 1
    `).bind(input.environment, input.reportKey, input.resourceType, input.resourceId, input.sourceSnapshotId, input.outputType)
      .first<GeneratedArtifactRow>();
    return row ? mapRow(row) : null;
  }

  async create(artifact: GeneratedArtifact): Promise<boolean> {
    try {
      const result = await this.db.prepare(`
        INSERT INTO generated_artifacts (
          id, environment, report_key, definition_version, template_key, template_version,
          resource_type, resource_id, source_snapshot_id, generation_intent, output_type,
          object_identifier, content_type, byte_length, requested_at, generated_at, generated_by, status, version, failure_code, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        artifact.id, artifact.environment, artifact.reportKey, artifact.definitionVersion,
        artifact.templateKey, artifact.templateVersion, artifact.resourceType, artifact.resourceId,
        artifact.sourceSnapshotId, artifact.generationIntent, artifact.outputType, artifact.objectIdentifier,
        artifact.contentType ?? null, artifact.byteLength ?? null, artifact.requestedAt, artifact.generatedAt ?? null, artifact.generatedBy,
        artifact.status, artifact.version, artifact.failureCode ?? null, artifact.expiresAt ?? null,
      ).run();
      return (result.meta?.changes ?? 0) === 1;
    } catch (error) {
      if (isConstraintError(error)) return false;
      throw error;
    }
  }

  async transition(input: { id: string; environment: string; expectedVersion: number; from: GeneratedArtifact["status"]; to: GeneratedArtifact["status"]; patch?: Partial<Pick<GeneratedArtifact, "objectIdentifier" | "contentType" | "byteLength" | "requestedAt" | "generatedAt" | "failureCode">> }): Promise<GeneratedArtifact | null> {
    const current = await this.get(input.id, input.environment);
    if (!current || current.version !== input.expectedVersion || current.status !== input.from) return null;
    const next = { ...current, ...input.patch, status: input.to, version: current.version + 1 } satisfies GeneratedArtifact;
    const result = await this.db.prepare(`UPDATE generated_artifacts SET object_identifier = ?, content_type = ?, byte_length = ?, requested_at = ?, generated_at = ?, status = ?, failure_code = ?, version = ? WHERE environment = ? AND id = ? AND version = ? AND status = ?`).bind(next.objectIdentifier, next.contentType ?? null, next.byteLength ?? null, next.requestedAt, next.generatedAt ?? null, next.status, next.failureCode ?? null, next.version, input.environment, input.id, input.expectedVersion, input.from).run();
    return (result.meta?.changes ?? 0) === 1 ? Object.freeze(next) : null;
  }
}
