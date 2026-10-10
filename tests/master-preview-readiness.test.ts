import assert from "node:assert/strict";
import test from "node:test";
import { classifyMasterPreviewReadiness, masterPreviewReadinessMessage } from "../src/reference/admin/master-preview-readiness";

const eligible = {
  available: true,
  reasonCode: null,
  preview: { policyDecision: "REQUIRE_REASON" },
} as const;

test("Preview readiness never derives authorization from Project links or a 2xx alone", () => {
  assert.equal(classifyMasterPreviewReadiness(200, eligible), "reviewable");
  assert.equal(classifyMasterPreviewReadiness(200, { ...eligible, available: false, reasonCode: "stale_version" }), "blocked");
  assert.equal(classifyMasterPreviewReadiness(200, {
    ...eligible, preview: { policyDecision: "DENY" },
  }), "blocked");
  assert.equal(classifyMasterPreviewReadiness(200, null), "unknown");
  assert.equal(classifyMasterPreviewReadiness(200, { ...eligible, available: undefined } as never), "unknown");
});

test("Preview HTTP denial, hidden/unsupported target, invalid input, and outages fail closed", () => {
  for (const status of [401, 403]) {
    assert.equal(classifyMasterPreviewReadiness(status, eligible), "access-restricted");
  }
  assert.equal(classifyMasterPreviewReadiness(404, eligible), "not-exposed");
  assert.equal(classifyMasterPreviewReadiness(400, eligible), "blocked");
  assert.equal(classifyMasterPreviewReadiness(409, eligible), "blocked");
  for (const status of [429, 500, 503, null]) {
    assert.equal(classifyMasterPreviewReadiness(status, eligible), "unknown");
  }
  assert.match(masterPreviewReadinessMessage("reviewable"), /実行時にも権限/u);
  assert.match(masterPreviewReadinessMessage("unknown"), /実行せず/u);
});
