import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryObjectStorage } from "../src/shared/object-storage";
import { InMemoryGeneratedArtifactStore } from "../src/shared/report";
import type { GeneratedArtifact } from "../src/shared/report/report";
import { projectWorkhubTravelReportStatus } from "../src/reference/workhub/report-status";
import { handleReportArtifactDownload } from "../src/worker/http/report-artifact-download";

test("#350 ready report with malformed expiry is unavailable, never falsely ready", () => {
  const now = new Date("2026-10-14T00:00:00.000Z");
  for (const expiresAt of ["", "not-a-date", "2026-02-30T00:00:00.000Z", "2026-10-15T00:00:00+00:00"]) {
    assert.deepEqual(projectWorkhubTravelReportStatus({ status: "ready", expiresAt }, now),
      { state: "unavailable" }, `non-canonical expiry ${JSON.stringify(expiresAt)}`);
  }
  assert.deepEqual(projectWorkhubTravelReportStatus({ status: "ready" }, now), { state: "ready" });
  assert.deepEqual(projectWorkhubTravelReportStatus({
    status: "ready", expiresAt: "2026-10-15T00:00:00.000Z",
  }, now), { state: "ready" });
  assert.deepEqual(projectWorkhubTravelReportStatus({
    status: "ready", expiresAt: "2026-10-14T00:00:00.000Z",
  }, now), { state: "expired" });
});

test("#350 malformed report expiry is rejected by server without reading private binary", async () => {
  const storage = new InMemoryObjectStorage({ environment: "test" });
  const artifacts = new InMemoryGeneratedArtifactStore();
  const scenarios: ReadonlyArray<{ expiry?: string; expected: number }> = [
    { expected: 200 },
    { expiry: "2026-10-15T00:00:00.000Z", expected: 200 },
    { expiry: "2026-10-14T00:00:00.000Z", expected: 404 },
    { expiry: "", expected: 404 },
    { expiry: "not-a-date", expected: 404 },
    { expiry: "2026-02-30T00:00:00.000Z", expected: 404 },
    { expiry: "2026-10-15T00:00:00+00:00", expected: 404 },
  ];

  for (const [index, { expiry, expected }] of scenarios.entries()) {
    const artifact: GeneratedArtifact = {
      id: `artifact-${index}`, environment: "test", reportKey: "workhub.travel-approval",
      definitionVersion: "1", templateKey: "test-html", templateVersion: "1",
      resourceType: "workhub.travel_request", resourceId: "travel-1",
      sourceSnapshotId: "snapshot-1", generationIntent: "original", outputType: "html",
      objectIdentifier: `private-object-${index}`, contentType: "text/plain",
      requestedAt: "2026-10-01T00:00:00.000Z", generatedAt: "2026-10-01T00:00:01.000Z",
      generatedBy: "aoi", status: "ready", version: 1,
      ...(expiry !== undefined ? { expiresAt: expiry } : {}),
    };
    assert.equal(await artifacts.create(artifact), true);
    await storage.put({
      identifier: artifact.objectIdentifier, body: new TextEncoder().encode("private report"),
      metadata: { contentType: "text/plain" }, overwrite: "forbid",
    });
    let authorizations = 0;
    const response = await handleReportArtifactDownload({
      request: new Request("https://example.test/reports"), requestId: "expiry-check",
      principalId: "aoi", environment: "test", artifactId: artifact.id,
      artifacts, storage, now: () => new Date("2026-10-14T00:00:00.000Z"),
      authorizer: { canDownload: () => { authorizations++; return true; } },
      filename: () => "travel-report.html",
    });
    assert.equal(response.status, expected, `expiry case ${index}`);
    assert.equal(authorizations, expected === 200 ? 1 : 0,
      "expired or invalid artifact must never reach the private object boundary");
    if (expected === 404) assert.doesNotMatch(await response.text(), /private report/u);
  }
});
