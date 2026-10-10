import assert from "node:assert/strict";
import test from "node:test";
import { classifyMasterOperationOutcome, masterOperationRecoveryMessage } from "../src/reference/admin/master-operation-outcome";

test("only verified SUCCESS/PASSED is reported as confirmed", () => {
  const ok = { execution: { result: "SUCCESS" }, verification: { status: "PASSED" } };
  assert.equal(classifyMasterOperationOutcome(200, ok), "verified");
  assert.equal(classifyMasterOperationOutcome(202, ok), "verified");
  assert.equal(classifyMasterOperationOutcome(200, null), "unknown");
  assert.equal(classifyMasterOperationOutcome(200, { execution: { result: "SUCCESS" } }), "unknown");
  assert.equal(classifyMasterOperationOutcome(200, { execution: { result: "SUCCESS" }, verification: { status: "FAILED" } }), "unknown");
  assert.equal(classifyMasterOperationOutcome(503, ok), "unknown");
});
test("conflict, auth rejection, timeout and generic errors have distinct recovery guidance", () => {
  assert.equal(classifyMasterOperationOutcome(409, null), "conflict");
  for (const status of [400, 401, 403, 422, 429]) {
    assert.equal(classifyMasterOperationOutcome(status, null), "rejected");
  }
  for (const status of [0, 500, 503, 504]) {
    assert.equal(classifyMasterOperationOutcome(status, null), "unknown");
  }
  assert.match(masterOperationRecoveryMessage("conflict"), /Version/);
  assert.match(masterOperationRecoveryMessage("unknown"), /自動再実行せず/);
  assert.match(masterOperationRecoveryMessage("rejected"), /拒否/);
});
