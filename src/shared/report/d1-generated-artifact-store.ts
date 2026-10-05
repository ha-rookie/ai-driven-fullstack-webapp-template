import type { GeneratedArtifact } from "./report";
import type { GeneratedArtifactStore } from "./artifact-service";

interface GeneratedArtifactRow {
  id: string; environment: string; report_key: string; definition_version: string;
  template_key: string; template_version: string; resource_type: string; resource_id: string;
  source_snapshot_id: string; generation_intent: GeneratedArtifact["generationIntent"];
  output_type: GeneratedArtifact["outputType"]; object_identifier: string; content_type: string;
  byte_length: number; generated_at: string; generated_by: string; status: GeneratedArtifact["status"]; version: number;
}

const mapRow = (row: GeneratedArtifactRow): GeneratedArtifact => Object.freeze({
  id: row.id, environment: row.environment, reportKey: row.report_key, definitionVersion: row.definition_version,
  templateKey: row.template_key, templateVersion: row.template_version, resourceType: row.resource_type,
  resourceId: row.resource_id, sourceSnapshotId: row.source_snapshot_id, generationIntent: row.generation_intent,
  outputType: row.output_type, objectIdentifier: row.object_identifier, contentType: row.content_type,
  byteLength: row.byte_length, generatedAt: row.generated_at, generatedBy: row.generated_by,
  status: row.status, version: row.version,
});

const isConstraintError = (error: unknown): boolean =>
  error instanceof Error && /UNIQUE constraint failed|constraint failed/iu.test(error.message);

export class D1GeneratedArtifactStore implements GeneratedArtifactStore {
  constructor(private readonly db: D1Database) {}

  async get(id: string, environment: string): Promise<GeneratedArtifact | null> {
    const row = await this.db.prepare(`
      SELECT id, environment, report_key, definition_version, template_key, template_version,
             resource_type, resource_id, source_snapshot_id, generation_intent, output_type,
             object_identifier, content_type, byte_length, generated_at, generated_by, status, version
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
             object_identifier, content_type, byte_length, generated_at, generated_by, status, version
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
          object_identifier, content_type, byte_length, generated_at, generated_by, status, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        artifact.id, artifact.environment, artifact.reportKey, artifact.definitionVersion,
        artifact.templateKey, artifact.templateVersion, artifact.resourceType, artifact.resourceId,
        artifact.sourceSnapshotId, artifact.generationIntent, artifact.outputType, artifact.objectIdentifier,
        artifact.contentType, artifact.byteLength, artifact.generatedAt, artifact.generatedBy,
        artifact.status, artifact.version,
      ).run();
      return (result.meta?.changes ?? 0) === 1;
    } catch (error) {
      if (isConstraintError(error)) return false;
      throw error;
    }
  }
}
