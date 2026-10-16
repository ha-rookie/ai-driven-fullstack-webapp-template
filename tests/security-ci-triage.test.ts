import assert from "node:assert/strict";
import test from "node:test";
import { classifySecurityCi, type CiObservation, type CiExecution } from "../src/shared/security/security-ci-triage";

const run = (id: number, conclusion: CiExecution["checkConclusion"] = "success",
  sha = "a".repeat(40)): CiExecution => ({
  runId: id, targetSha: sha, checkStatus: "completed", checkConclusion: conclusion,
});
const observed = (latest: CiExecution | null, success: CiExecution | null): CiObservation =>
  ({ state: "available", latest, latestSuccessfulRun: success });

test("#420 CI status: current CI success is not a Finding or security posture", () => {
  const result = classifySecurityCi(observed(run(11), run(11)));
  assert.equal(result.needsAttention, false);
  assert.match(result.label, /CI最新Run成功（Finding未評価）/u);
  assert.match(result.history, /最新Runの成功記録/u);
  assert.doesNotMatch(JSON.stringify(result), /安全|SCS適合|脆弱性0/u);
});

test("#420 CI status: previous success never masks a later failure or new target SHA", () => {
  const result = classifySecurityCi(observed(run(12, "failure", "b".repeat(40)), run(11)));
  assert.equal(result.needsAttention, true);
  assert.match(result.label, /失敗／中断/u);
  assert.match(result.history, /別SHA/u);
});

test("#420 CI status: same SHA historical success does not certify a later run", () => {
  const result = classifySecurityCi(observed(run(12, "cancelled"), run(11)));
  assert.equal(result.needsAttention, true);
  assert.match(result.history, /同一SHA・最新Runの結果ではない/u);
});

test("#420 CI status: queued, in-progress, skipped and neutral remain actionable", () => {
  for (const latest of [
    { runId: 13, targetSha: "c".repeat(40), checkStatus: "queued" as const },
    { runId: 13, targetSha: "c".repeat(40), checkStatus: "in-progress" as const },
    run(13, "skipped"), run(13, "neutral"),
  ]) {
    const result = classifySecurityCi(observed(latest, run(12)));
    assert.equal(result.needsAttention, true);
    assert.doesNotMatch(result.label, /最新Run成功/u);
  }
});

test("#420 CI status: source unavailable, not-connected, no runs, no known recent success are separate unknowns", () => {
  for (const state of ["unavailable", "not-connected"] as const) {
    const result = classifySecurityCi({ state, latest: null, latestSuccessfulRun: null });
    assert.equal(result.needsAttention, true);
    assert.match(result.history, /未取得/u);
  }
  const empty = classifySecurityCi(observed(null, null));
  assert.equal(empty.needsAttention, true);
  assert.match(empty.label, /記録なし/u);
  assert.match(empty.history, /直近5件/u);
  const latestFailed = classifySecurityCi(observed(run(22, "failure"), null));
  assert.equal(latestFailed.needsAttention, true);
  assert.match(latestFailed.history, /全履歴は未確認/u);
});

test("#420 CI status: an inconsistent latest-success claim fails closed instead of looking healthy", () => {
  for (const ci of [observed(run(14), null), observed(run(14), run(13)),
    observed(run(14, "success", "b".repeat(40)), run(14))]) {
    const result = classifySecurityCi(ci);
    assert.equal(result.needsAttention, true);
    assert.match(result.label, /矛盾/u);
  }
});
