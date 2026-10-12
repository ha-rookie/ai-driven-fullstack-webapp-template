import assert from "node:assert/strict";
import test from "node:test";
import { listWorkhubReferenceDocuments } from "../src/reference/workhub/documents";

test("documents are role-filtered before they are projected or counted", () => {
  const employee = listWorkhubReferenceDocuments("employee");
  const manager = listWorkhubReferenceDocuments("manager");
  const newcomer = listWorkhubReferenceDocuments("newcomer");
  assert.equal(employee.length, 4);
  assert.equal(manager.length, 5);
  assert.equal(newcomer.length, 1);
  assert.equal(listWorkhubReferenceDocuments("unknown").length, 0);
  assert.equal(listWorkhubReferenceDocuments("").length, 0);
  assert.ok(manager.some(doc => doc.id === "incident-management"));
  assert.ok(!employee.some(doc => doc.id === "incident-management"));
  assert.ok(!newcomer.some(doc => doc.title.includes("出張")));
  assert.ok(!JSON.stringify(employee).includes("インシデント"));
});

test("document governance metadata is explicit, usable, and free of authorization rules", () => {
  const entries = listWorkhubReferenceDocuments("manager");
  assert.ok(entries.some(doc => doc.state === "current"));
  assert.ok(entries.some(doc => doc.state === "stale"));
  assert.ok(entries.some(doc => doc.state === "superseded"));
  for (const doc of entries) {
    assert.deepEqual(Object.keys(doc).sort(), [
      "category", "id", "ownerLabel", "replacementTitle", "reviewedAt", "state", "summary", "title", "version",
    ]);
    assert.match(doc.reviewedAt, /^2026-\d\d-\d\d$/u);
    assert.ok(Number.isInteger(doc.version) && doc.version > 0);
    assert.ok(doc.ownerLabel.trim());
  }
  const legacy = entries.find(doc => doc.state === "superseded");
  assert.equal(legacy?.replacementTitle, entries.find(doc => doc.id === "travel-expense-current")?.title);
  assert.doesNotMatch(JSON.stringify(entries), /allowedRoles|email|phone|password|internalUserId|workhub-demo-/iu);
});
