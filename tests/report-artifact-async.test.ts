import assert from "node:assert/strict";
import test from "node:test";

import { executeAsyncJob, InMemoryAsyncJobStateStore, type AsyncJobEnvelope, type AsyncJobPublisher } from "../src/shared/async-job";
import { InMemoryObjectStorage } from "../src/shared/object-storage";
import {
  AsyncReportGenerationService,
  InMemoryGeneratedArtifactStore,
  createAsyncReportHandler,
  buildReportViewModel,
  type ReportDefinition,
  type ReportRenderer,
} from "../src/shared/report";

const definition: ReportDefinition<{ label: string }> = {
  key: "example.report", version: "1", templateKey: "example.report.html", templateVersion: "1",
  outputTypes: ["html"],
  validateData(value) {
    if (!value || typeof value !== "object" || typeof (value as {label?:unknown}).label !== "string") throw new TypeError("invalid data");
    return { label: (value as {label:string}).label };
  },
};

const viewModel = buildReportViewModel({
  definition, resourceRef: { type: "example.resource", id: "resource-1" },
  sourceSnapshot: { id: "snapshot-1", sourceVersion: "7", capturedAt: "2026-10-06T00:00:00.000Z" },
  generationIntent: "original", generatedBy: "user-1", generatedAt: "2026-10-06T00:00:00.000Z",
  locale: "ja-JP", timezone: "Asia/Tokyo", data: { label: "approved" },
});

const renderer: ReportRenderer = {
  key: "test.html", supportedOutputTypes: ["html"],
  async render() { return { body: new TextEncoder().encode("<p>approved</p>"), contentType: "text/html; charset=utf-8", suggestedFilename: "report.html" }; },
};

class CapturePublisher implements AsyncJobPublisher {
  readonly jobs: AsyncJobEnvelope[] = [];
  async publish<T>(envelope: AsyncJobEnvelope<T>) { this.jobs.push(envelope as AsyncJobEnvelope); }
}

test("async report request reuses historical original and publishes deterministic #51 job identity", async () => {
  const artifacts = new InMemoryGeneratedArtifactStore();
  const publisher = new CapturePublisher();
  let sequence = 0;
  const service = new AsyncReportGenerationService({
    environment: "test", artifacts, publisher,
    authorizer: { assertCanGenerate() {} },
    generateId: () => `id-${++sequence}`,
    now: () => new Date("2026-10-06T00:00:00.000Z"),
  });
  const first = await service.request({ principalId: "user-1", definition, viewModel, outputType: "html" });
  const second = await service.request({ principalId: "user-1", definition, viewModel, outputType: "html" });
  assert.equal(first.artifact.id, second.artifact.id);
  assert.equal(first.artifact.status, "pending");
  assert.equal(first.job.idempotencyKey, second.job.idempotencyKey);
  assert.equal(publisher.jobs.length, 2);
  assert.deepEqual(first.job.payload, { artifactId: first.artifact.id, environment: "test" });
});

test("async report handler converges duplicate delivery to one ready artifact", async () => {
  const artifacts = new InMemoryGeneratedArtifactStore();
  const publisher = new CapturePublisher();
  let sequence = 0;
  const service = new AsyncReportGenerationService({
    environment: "test", artifacts, publisher,
    authorizer: { assertCanGenerate() {} },
    generateId: () => `id-${++sequence}`,
    now: () => new Date("2026-10-06T00:00:00.000Z"),
  });
  const requested = await service.request({ principalId: "user-1", definition, viewModel, outputType: "html" });
  const storage = new InMemoryObjectStorage({ environment: "test" });
  let resolveCount = 0;
  const handler = createAsyncReportHandler({
    environment: "test", artifacts, storage,
    resolver: { async resolve() { resolveCount += 1; return { definition: definition as ReportDefinition<unknown>, viewModel: viewModel as typeof viewModel & {data:unknown}, renderer }; } },
  });
  const jobStore = new InMemoryAsyncJobStateStore();
  const run = () => executeAsyncJob({
    envelope: requested.job, store: jobStore, handler,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
    leaseMs: 30000,
    clock: { now: () => new Date("2026-10-06T00:00:01.000Z") },
    idGenerator: { generate: () => "lease-1" },
  });
  assert.equal((await run()).kind, "completed");
  assert.equal((await run()).kind, "duplicate_completed");
  const ready = await artifacts.get(requested.artifact.id, "test");
  assert.equal(ready?.status, "ready");
  assert.ok((ready?.byteLength ?? 0) > 0);
  assert.equal(resolveCount, 1);
});
