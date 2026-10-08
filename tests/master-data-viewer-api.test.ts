import assert from "node:assert/strict";
import test from "node:test";
import { classifyMasterRevision, handleMasterDataViewerApi } from "../src/worker/administration/master-data-viewer-api";

const options = { scopeId: "workhub-company", masterKeys: ["workhub.office"] };
const noSessionDb = {
  prepare() {
    return { bind() { return { first: async () => null }; } };
  },
} as unknown as D1Database;

test("master-data route rejects non-GET requests and missing environment", async () => {
  const method = await handleMasterDataViewerApi(
    new Request("https://example.test/api/admin/master-data", { method: "POST" }),
    { DB: noSessionDb, RUNTIME_ENVIRONMENT: "test" }, "req-1", options,
  );
  assert.equal(method?.status, 405);
  const environment = await handleMasterDataViewerApi(
    new Request("https://example.test/api/admin/master-data"),
    { DB: noSessionDb }, "req-2", options,
  );
  assert.equal(environment?.status, 503);
});

test("master-data route does not expose data without authentication", async () => {
  const response = await handleMasterDataViewerApi(
    new Request("https://example.test/api/admin/master-data?scopeId=workhub-company&masterKey=workhub.office"),
    { DB: noSessionDb, RUNTIME_ENVIRONMENT: "test" }, "req-3", options,
  );
  assert.equal(response?.status, 401);
  const body = await response?.json() as { error: { code: string } };
  assert.equal(body.error.code, "authentication_required");
});

test("master-data read route does not capture other paths", async () => {
  assert.equal(await handleMasterDataViewerApi(
    new Request("https://example.test/api/admin/jobs"),
    { DB: noSessionDb, RUNTIME_ENVIRONMENT: "test" }, "req-4", options,
  ), null);
});

test("master revision status respects half-open effective dates and retirement", () => {
  const revision = {
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: "2027-01-01T00:00:00.000Z",
    enabled: 1,
  };
  assert.equal(classifyMasterRevision(revision, "2025-12-31T23:59:59.999Z", null), "future");
  assert.equal(classifyMasterRevision(revision, "2026-01-01T00:00:00.000Z", null), "current");
  assert.equal(classifyMasterRevision(revision, "2027-01-01T00:00:00.000Z", null), "expired");
  assert.equal(classifyMasterRevision({ ...revision, enabled: 0 }, "2026-10-08T00:00:00.000Z", null), "disabled");
  assert.equal(classifyMasterRevision(revision, "2026-10-08T00:00:00.000Z", "2026-05-01T00:00:00.000Z"), "retired");
});
