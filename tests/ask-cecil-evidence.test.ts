import assert from "node:assert/strict";
import test from "node:test";
import { createCecilGuide, safeCecilTarget, type CecilDocument, type CecilSearchResult } from "../src/reference/workhub/ask-cecil";

const current: CecilDocument = {
  id: "travel-expense-current", title: "出張と経費精算の手順（デモ）",
  category: "手順", version: 3, ownerLabel: "経理（デモ）",
  reviewedAt: "2026-10-05", state: "current",
  summary: "出張申請から経費精算までの手順です。",
  replacementTitle: null,
};
const match: CecilSearchResult = {
  resourceType: "workhub_document", resourceId: current.id, category: "documents",
  title: current.title, actionTarget: "/#workhub-document-travel-expense-current",
};

test("Ask CECIL L0 uses only a current document authorized by both endpoints", () => {
  const answer = createCecilGuide([match], [current]);
  assert.equal(answer.status, "answer");
  assert.equal(answer.summary, current.summary);
  assert.deepEqual(answer.evidence.map(item => item.id), [current.id]);
  assert.equal(answer.evidence[0].version, 3);
  assert.equal(answer.evidence[0].ownerLabel, "経理（デモ）");
  assert.equal(answer.evidence[0].reviewedAt, "2026-10-05");
});

test("Ask CECIL cannot cite a search hit when current authorized document hydration excludes it", () => {
  const result = createCecilGuide([match], []);
  assert.equal(result.status, "find");
  assert.deepEqual(result.evidence, []);
  assert.ok(!result.summary.includes(current.summary));
});

test("Stale and superseded are not treated as authoritative L0 answers", () => {
  for (const state of ["stale", "superseded"] as const) {
    const old = createCecilGuide([match], [{ ...current, state }]);
    assert.equal(old.status, "outdated");
    assert.equal(old.evidence[0].freshness, state);
    assert.notEqual(old.summary, current.summary);
  }
});

test("Conflicting multiple current sources stay separately cited rather than synthesized", () => {
  const other = { ...current, id: "reference-other", title: "別の規程", summary: "別解釈" };
  const response = createCecilGuide([
    match, { ...match, resourceId: other.id, title: other.title }
  ], [current, other]);
  assert.equal(response.status, "multiple");
  assert.equal(response.evidence.length, 2);
  assert.ok(!response.summary.includes(other.summary));
});

test("Absent evidence never fabricates a policy or a resource identifier", () => {
  const empty = createCecilGuide([], [current]);
  assert.equal(empty.status, "insufficient");
  assert.deepEqual(empty.destinations, []);
  assert.deepEqual(empty.evidence, []);
});

test("Only local WORKHUB fragment targets are navigable", () => {
  for (const target of [
    "https://external.example/#workhub-documents",
    "javascript:alert(1)", "//evil.example", "/api/private",
    "/#outside", "/#workhub-../../admin", "", undefined,
  ]) assert.equal(safeCecilTarget(target), null);
  assert.equal(safeCecilTarget("/#workhub-document-travel-expense-current"), "/#workhub-document-travel-expense-current");
  assert.equal(safeCecilTarget("#workhub-apps"), "#workhub-apps");
});
