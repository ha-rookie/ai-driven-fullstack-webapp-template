import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";

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

  const objects = new Map<string, Uint8Array>();
  const storage = {
    async put(input: { identifier: string; body: Uint8Array; metadata: { contentType: string }; overwrite: "forbid" }) {
      assert.equal(objects.has(input.identifier), false);
      objects.set(input.identifier, input.body);
      return { identifier: input.identifier, byteLength: input.body.byteLength };
    },
  };

  const artifacts = new InMemoryGeneratedArtifactStore();
  let authorized = 0;
  const service = new ReportArtifactService({
    environment: "test",
    storage: storage as never,
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

  const body = objects.get(artifact.objectIdentifier);
  assert.ok(body);
  assert.deepEqual(Array.from(body.slice(0, 2)), [0x50, 0x4b]);

  const entries = unzipSync(body);
  const xml = Object.entries(entries)
    .filter(([name]) => name.endsWith(".xml"))
    .map(([, bytes]) => new TextDecoder().decode(bytes))
    .join("\n");
  assert.equal(xml.includes("private-object-001"), false);
  assert.equal(xml.includes("生成帳票一覧"), true);
});
