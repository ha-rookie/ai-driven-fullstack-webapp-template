import assert from "node:assert/strict";
import test from "node:test";
import { createCecilEscalationNote } from "../src/reference/workhub/ask-cecil-escalation";
import { createCecilGuide, type CecilDocument, type CecilSearchResult } from "../src/reference/workhub/ask-cecil";

const current: CecilDocument = {
  id: "travel-ops", title: "出張手順", category: "手順", version: 3,
  ownerLabel: "経理", reviewedAt: "2026-10-05", state: "current",
  summary: "現在の出張手順", replacementTitle: null,
};
const result: CecilSearchResult = {
  resourceType: "workhub_document", resourceId: current.id,
  category: "documents", title: current.title, actionTarget: "/#workhub-document-travel-ops",
};

test("L0 source metadata is included only after fresh authorized revision read", () => {
  const guide = createCecilGuide([result], [current]);
  const note = createCecilEscalationNote("出張規程の例外は？", guide, [current]);
  assert.match(note, /出張規程の例外は？/u);
  assert.match(note, /出張手順 \(v3 \/ 現行 \/ 管理: 経理/u);
  assert.match(note, /まだ誰にも送信されていません/u);
  assert.ok(!note.includes(current.summary), "do not copy source summary or search snippets");
  for (const newer of [
    [], [{ ...current, version: 4 }], [{ ...current, state: "superseded" as const }],
    [{ ...current, ownerLabel: "別部署" }],
  ]) {
    const restricted = createCecilEscalationNote("出張規程の例外は？", guide, newer);
    assert.ok(!restricted.includes("出張手順 (v3"));
    assert.match(restricted, /出典は添付していません/u);
  }
});

test("conflicting sources are not synthesized; both verified names remain separate", () => {
  const other = { ...current, id: "expenses-faq", title: "経費FAQ", summary: "違う判断" };
  const guide = createCecilGuide([result, { ...result, resourceId: other.id, title: other.title }], [current, other]);
  assert.equal(guide.status, "multiple");
  const note = createCecilEscalationNote("どちらが正しい？", guide, [current, other]);
  assert.match(note, /資料が複数あり/u);
  assert.match(note, /出張手順/u);
  assert.match(note, /経費FAQ/u);
  assert.ok(!note.includes("違う判断"));
});

test("outdated/insufficient/error escalation does not invent a policy, person, ticket or private result", () => {
  const old = { ...current, state: "superseded" as const };
  const staleGuide = createCecilGuide([result], [old]);
  const oldNote = createCecilEscalationNote("最新版は？", staleGuide, [old]);
  assert.match(oldNote, /旧版/u);
  assert.match(oldNote, /正式な回答として扱っていません/u);
  const noEvidence = createCecilEscalationNote("社員の給与は？", createCecilGuide([], []), []);
  assert.match(noEvidence, /回答の根拠が不足/u);
  assert.ok(!noEvidence.includes("出張手順"));
  const error = createCecilEscalationNote("聞きたい", null, []);
  assert.match(error, /送信されていません/u);
  assert.ok(!error.includes("問い合わせ番号"));
});
