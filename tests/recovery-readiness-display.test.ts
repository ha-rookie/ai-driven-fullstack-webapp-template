import assert from "node:assert/strict";
import test from "node:test";
import { describeMissingRecoveryEvidence } from "../src/reference/admin/RecoveryReadiness";

test("#431 missing recovery evidence codes have actionable Japanese labels", () => {
  const labels = describeMissingRecoveryEvidence([
    "source_not_verified", "restore_verification_missing", "restore_test_stale",
  ]);
  assert.match(labels, /取得元が確認できません/u);
  assert.match(labels, /復元テストの記録がありません/u);
  assert.match(labels, /期限切れです/u);
  assert.doesNotMatch(labels, /source_not_verified|restore_verification_missing|restore_test_stale/u);
});

test("#430 malformed reason text is not echoed into the admin display", () => {
  const labels = describeMissingRecoveryEvidence(["provider-secret-token=123"]);
  assert.equal(labels, "未確認の復旧証跡があります");
  assert.doesNotMatch(labels, /provider-secret-token|123/u);
});

test("#431 no missing evidence is not presented as verified recoverability", () => {
  assert.equal(describeMissingRecoveryEvidence([]),
    "登録上の欠測なし（実際の復旧保証ではありません）");
});
