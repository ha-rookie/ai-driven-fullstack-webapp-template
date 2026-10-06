import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";

import { InMemoryObjectStorage } from "../src/shared/object-storage";
import { handleReportArtifactDownload } from "../src/worker/http/report-artifact-download";

import {
  InMemoryGeneratedArtifactStore,
  ReportArtifactService,
  WriteExcelFileReportRenderer,
  type GeneratedArtifact,
} from "../src/shared/report";
import {
  buildWorkhubArtifactInventoryReport,
  WORKHUB_ARTIFACT_INVENTORY_XLSX_REPORT,
  WORKHUB_ARTIFACT_INVENTORY_XLSX_TEMPLATE,
} from "../src/reference/workhub/artifact-inventory-report";

const sourceArtifacts: GeneratedArtifact[] = [
  {
    id: "artifact-001",
    environment: "test",
    reportKey: "workhub.travel-approval",
    definitionVersion: "1",
    templateKey: "workhub.travel-approval.pdf",
    templateVersion: "1",
    resourceType: "travel_request",
    resourceId: "travel-001",
    sourceSnapshotId: "travel-snapshot-001",
    generationIntent: "original",
    outputType: "pdf",
    objectIdentifier: "private-object-001",
    contentType: "application/pdf",
    byteLength: 1234,
    requestedAt: "2026-10-06T01:00:00.000Z",
    generatedAt: "2026-10-06T01:00:01.000Z",
    generatedBy: "aoi",
    status: "ready",
    version: 1,
  },
];

test("artifact inventory reuses report foundation and emits XLSX without leaking object identifiers", async () => {
  const viewModel = buildWorkhubArtifactInventoryReport({
    artifacts: sourceArtifacts,
    inventoryId: "inventory-001",
    sourceVersion: "1",
    capturedAt: "2026-10-06T02:00:00.000Z",
    generatedBy: "ops-admin",
    generatedAt: "2026-10-06T02:00:00.000Z",
  });

  assert.equal(viewModel.resourceRef.type, "generated_artifact_inventory");
  assert.equal(viewModel.data.rows[0]?.artifactId, "artifact-001");
  assert.equal(JSON.stringify(viewModel.data).includes("private-object-001"), false);

  const storage = new InMemoryObjectStorage({ environment: "test" });
  const artifacts = new InMemoryGeneratedArtifactStore();
  let authorized = 0;
  const service = new ReportArtifactService({
    environment: "test",
    storage,
    artifacts,
    authorizer: {
      assertCanGenerate(input) {
        authorized += 1;
        assert.equal(input.resourceType, "generated_artifact_inventory");
        assert.equal(input.resourceId, "inventory-001");
        assert.equal(input.reportKey, "workhub.artifact-inventory");
      },
    },
    generateId: (() => {
      let value = 0;
      return () => `generated-${++value}`;
    })(),
  });

  const renderer = new WriteExcelFileReportRenderer(() => WORKHUB_ARTIFACT_INVENTORY_XLSX_TEMPLATE);
  const artifact = await service.generate({
    principalId: "ops-admin",
    definition: WORKHUB_ARTIFACT_INVENTORY_XLSX_REPORT,
    viewModel,
    renderer,
    outputType: "xlsx",
    intent: "original",
  });

  assert.equal(authorized, 1);
  assert.equal(artifact.resourceType, "generated_artifact_inventory");
  assert.equal(artifact.outputType, "xlsx");
  assert.equal(artifact.status, "ready");

  const stored = await storage.get(artifact.objectIdentifier);
  assert.ok(stored);
  const body = new Uint8Array(await new Response(stored.body).arrayBuffer());
  assert.deepEqual(Array.from(body.slice(0, 2)), [0x50, 0x4b]);

  const entries = unzipSync(body);
  const xml = Object.entries(entries)
    .filter(([name]) => name.endsWith(".xml"))
    .map(([, bytes]) => new TextDecoder().decode(bytes))
    .join("\n");
  assert.equal(xml.includes("private-object-001"), false);
  assert.equal(xml.includes("生成帳票一覧"), true);

  let canDownload = true;
  const download = () =>
    handleReportArtifactDownload({
      request: new Request(`https://example.test/api/admin/report-artifacts/${artifact.id}`),
      requestId: "req-artifact-inventory",
      principalId: "ops-admin",
      environment: "test",
      artifactId: artifact.id,
      artifacts,
      storage,
      authorizer: { canDownload: () => canDownload },
      filename: () => "generated-artifact-inventory.xlsx",
    });

  const response = await download();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.match(response.headers.get("content-disposition") ?? "", /attachment/);

  canDownload = false;
  assert.equal((await download()).status, 404);
});
