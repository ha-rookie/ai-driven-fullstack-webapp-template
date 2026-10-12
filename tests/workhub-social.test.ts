import assert from "node:assert/strict";
import test from "node:test";
import { listWorkhubSocialReference } from "../src/reference/workhub/social";

test("social reference has a safe explicit role-filtered display projection", () => {
  const employee = listWorkhubSocialReference("employee");
  const manager = listWorkhubSocialReference("manager");
  const newcomer = listWorkhubSocialReference("newcomer");
  assert.equal(employee.length, 3);
  assert.equal(manager.length, 4);
  assert.equal(newcomer.length, 2);
  assert.deepEqual(listWorkhubSocialReference("unknown"), []);
  assert.ok(manager.some(item => item.id === "reference-manager-community"));
  assert.ok(!employee.some(item => item.id === "reference-manager-community"));
  assert.doesNotMatch(JSON.stringify(employee), /マネージャー向け交流会|reference-manager-community/u);
  assert.deepEqual(Object.keys(employee[0]).sort(), [
    "authorLabel", "body", "category", "commentCount", "createdAt", "id", "reactionCount", "title",
  ]);
  for (const post of manager) {
    assert.match(post.authorLabel, /デモ/u);
    assert.ok(Number.isInteger(post.reactionCount) && post.reactionCount >= 0);
    assert.ok(Number.isInteger(post.commentCount) && post.commentCount >= 0);
  }
  assert.doesNotMatch(JSON.stringify(manager), /allowedRoles|workhub-demo-|password|email|phone|principalId/u);
});
