import assert from "node:assert/strict";
import test from "node:test";

import { D1GeneratedArtifactStore, type GeneratedArtifact } from "../src/shared/report";

class Statement {
  private bindings: unknown[] = [];
  constructor(private readonly db: FakeD1Database, private readonly sql: string) {}
  bind(...values: unknown[]) { this.bindings = values; return this; }
  async first<T>(): Promise<T | null> { return this.db.first(this.sql, this.bindings) as T | null; }
  async run(): Promise<D1Result<unknown>> { return this.db.run(this.sql, this.bindings) as D1Result<unknown>; }
}

class FakeD1Database {
  readonly rows: Record<string, unknown>[] = [];
  prepare(sql: string) { return new Statement(this, sql); }
  first(sql: string, values: unknown[]) {
    if (sql.includes("WHERE environment = ? AND id = ?")) {
      return this.rows.find((r) => r.environment === values[0] && r.id === values[1]) ?? null;
    }
    return this.rows.find((r) =>
      r.environment === values[0] && r.report_key === values[1] && r.resource_type === values[2] &&
      r.resource_id === values[3] && r.source_snapshot_id === values[4] && r.output_type === values[5] &&
      r.generation_intent === "original") ?? null;
  }
  run(sql: string, values: unknown[]) {
    assert.match(sql, /INSERT INTO generated_artifacts/u);
    const keys = ["id","environment","report_key","definition_version","template_key","template_version","resource_type","resource_id","source_snapshot_id","generation_intent","output_type","object_identifier","content_type","byte_length","requested_at","generated_at","generated_by","status","version","failure_code","expires_at"];
    const row = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    const duplicateId = this.rows.some((r) => r.environment === row.environment && r.id === row.id);
    const duplicateOriginal = row.generation_intent === "original" && this.rows.some((r) =>
      r.environment === row.environment && r.report_key === row.report_key && r.resource_type === row.resource_type &&
      r.resource_id === row.resource_id && r.source_snapshot_id === row.source_snapshot_id &&
      r.output_type === row.output_type && r.generation_intent === "original");
    if (duplicateId || duplicateOriginal) throw new Error("UNIQUE constraint failed");
    this.rows.push(row);
    return { meta: { changes: 1 } };
  }
}

const artifact = (overrides: Partial<GeneratedArtifact> = {}): GeneratedArtifact => ({
  id: "artifact-1", environment: "test", reportKey: "workhub.travel.approval", definitionVersion: "1",
  templateKey: "workhub.travel.approval.html", templateVersion: "1", resourceType: "workhub.travel_request",
  resourceId: "travel-1", sourceSnapshotId: "snapshot-1", generationIntent: "original", outputType: "html",
  objectIdentifier: "object-1", contentType: "text/html; charset=utf-8", byteLength: 128,
  requestedAt: "2026-10-06T00:00:00.000Z", generatedAt: "2026-10-06T00:00:00.000Z", generatedBy: "aoi", status: "ready", version: 1, ...overrides,
});

test("D1 generated artifact metadata survives store re-instantiation and stays environment scoped", async () => {
  const db = new FakeD1Database();
  const first = new D1GeneratedArtifactStore(db as unknown as D1Database);
  assert.equal(await first.create(artifact()), true);

  const second = new D1GeneratedArtifactStore(db as unknown as D1Database);
  assert.equal((await second.get("artifact-1", "test"))?.objectIdentifier, "object-1");
  assert.equal(await second.get("artifact-1", "production"), null);
});

test("D1 generated artifact store enforces one historical original identity", async () => {
  const db = new FakeD1Database();
  const store = new D1GeneratedArtifactStore(db as unknown as D1Database);
  assert.equal(await store.create(artifact()), true);
  assert.equal(await store.create(artifact({ id: "artifact-2", objectIdentifier: "object-2" })), false);
  assert.equal((await store.findOriginal({
    environment: "test", reportKey: "workhub.travel.approval", resourceType: "workhub.travel_request",
    resourceId: "travel-1", sourceSnapshotId: "snapshot-1", outputType: "html",
  }))?.id, "artifact-1");
  assert.equal(await store.create(artifact({ id: "artifact-3", generationIntent: "reissue", objectIdentifier: "object-3" })), true);
});

test("D1 generated artifact store persists optional expiry metadata", async () => {
  const db = new FakeD1Database();
  const store = new D1GeneratedArtifactStore(db as unknown as D1Database);
  assert.equal(await store.create(artifact({ expiresAt: "2026-11-01T00:00:00.000Z" })), true);
  assert.equal((await store.get("artifact-1", "test"))?.expiresAt, "2026-11-01T00:00:00.000Z");
});
