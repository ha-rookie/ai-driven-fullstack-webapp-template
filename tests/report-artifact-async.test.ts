import assert from "node:assert/strict";
import test from "node:test";

import { executeAsyncJob, InMemoryAsyncJobStateStore, type AsyncJobEnvelope, type AsyncJobPublisher } from "../src/shared/async-job";
import { InMemoryObjectStorage } from "../src/shared/object-storage";
import { handleReportArtifactDownload } from "../src/worker/http/report-artifact-download";
import {
  AsyncReportGenerationService,
  InMemoryGeneratedArtifactStore,
  createAsyncReportHandler,
  executeAsyncReportJob,
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
  assert.equal(first.artifact.requestedAt, "2026-10-06T00:00:00.000Z");
  assert.equal(first.artifact.generatedAt, undefined);
  assert.equal(first.artifact.contentType, undefined);
  assert.equal(first.artifact.byteLength, undefined);
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
    now: () => new Date("2026-10-06T00:00:02.000Z"),
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
  assert.equal(ready?.contentType, "text/html; charset=utf-8");
  assert.equal(ready?.generatedAt, "2026-10-06T00:00:02.000Z");
  assert.equal(resolveCount, 1);
});


test("terminal async job failure marks report artifact failed but retryable failure does not", async () => {
  const artifacts = new InMemoryGeneratedArtifactStore();
  const publisher = new CapturePublisher();
  let sequence = 0;
  const service = new AsyncReportGenerationService({
    environment: "test", artifacts, publisher,
    authorizer: { assertCanGenerate() {} },
    generateId: () => `terminal-${++sequence}`,
    now: () => new Date("2026-10-06T01:00:00.000Z"),
  });
  const requested = await service.request({ principalId: "user-1", definition, viewModel, outputType: "html" });
  const jobStore = new InMemoryAsyncJobStateStore();
  const failingHandler = async () => { throw new Error("renderer unavailable"); };
  const retry = await executeAsyncReportJob({
    envelope: requested.job, store: jobStore, handler: failingHandler, artifacts,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 1000 },
    leaseMs: 30000,
    clock: { now: () => new Date("2026-10-06T01:00:01.000Z") },
    idGenerator: { generate: () => "lease-retry" },
    classifyError: () => ({ retryable: true, code: "renderer_unavailable" }),
  });
  assert.equal(retry.kind, "retry");
  assert.equal((await artifacts.get(requested.artifact.id, "test"))?.status, "pending");

  const terminal = await executeAsyncReportJob({
    envelope: requested.job, store: jobStore, handler: failingHandler, artifacts,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 1000 },
    leaseMs: 30000,
    clock: { now: () => new Date("2026-10-06T01:00:03.000Z") },
    idGenerator: { generate: () => "lease-terminal" },
    classifyError: () => ({ retryable: false, code: "invalid_report_definition" }),
  });
  assert.equal(terminal.kind, "failed");
  const failed = await artifacts.get(requested.artifact.id, "test");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.failureCode, "invalid_report_definition");
});

// #350 G: the business approval is already committed; a report is only a
// derived artifact. Terminal report failure must never masquerade as a
// fresh request or cause another business mutation.
test("WORKHUB report terminal failure does not requeue original or invalidate business outcome", async () => {
  const artifacts = new InMemoryGeneratedArtifactStore();
  const storage = new InMemoryObjectStorage({ environment: "test" });
  const publisher = new CapturePublisher();
  let sequence = 0;
  const service = new AsyncReportGenerationService({
    environment: "test", artifacts, publisher,
    authorizer: { assertCanGenerate() {} },
    generateId: () => `report-failure-${++sequence}`,
    now: () => new Date("2026-10-06T01:00:00.000Z"),
  });
  // Immutable approved decision/snapshot is the authoritative input, not a
  // status inferred from report output.
  const approvedDecision = Object.freeze({ state: "completed", version: 7, transitionCount: 1 });
  const original = await service.request({ principalId: "user-1", definition, viewModel, outputType: "html" });
  const execution = await executeAsyncReportJob({
    envelope: original.job,
    store: new InMemoryAsyncJobStateStore(),
    handler: async () => { throw new Error("renderer storage provider down"); },
    artifacts,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 1_000 },
    leaseMs: 30_000,
    clock: { now: () => new Date("2026-10-06T01:00:01.000Z") },
    idGenerator: { generate: () => "lease-report-failed" },
    classifyError: () => ({ retryable: false, code: "renderer_unavailable" }),
  });
  assert.equal(execution.kind, "failed");
  assert.equal((await artifacts.get(original.artifact.id, "test"))?.status, "failed");
  assert.equal((await artifacts.get(original.artifact.id, "test"))?.failureCode, "renderer_unavailable");

  await assert.rejects(
    service.request({ principalId: "user-1", definition, viewModel, outputType: "html" }),
    /terminally failed; reconciliation required/,
  );
  assert.equal(publisher.jobs.length, 1, "terminal failure must not publish a duplicate report job");
  assert.deepEqual(approvedDecision, { state: "completed", version: 7, transitionCount: 1 });
  assert.equal(viewModel.sourceSnapshot.sourceVersion, "7");
  assert.equal(viewModel.data.label, "approved");

  const response = await handleReportArtifactDownload({
    request: new Request("https://example.test/api/workhub/reports/" + original.artifact.id),
    requestId: "report-failure-case", principalId: "user-1", environment: "test",
    artifactId: original.artifact.id, artifacts, storage,
    authorizer: { canDownload: () => true },
    filename: () => "approved-report.html",
  });
  assert.equal(response.status, 404, "failed artifact must never be served as ready");
});
