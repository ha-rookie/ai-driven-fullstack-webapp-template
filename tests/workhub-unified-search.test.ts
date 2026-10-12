import assert from "node:assert/strict";
import test from "node:test";
import { rankWorkhubUnifiedResults, searchWorkhubReferenceCatalog } from "../src/reference/workhub/unified-search";

const search = (role: string, text: string, category: "all" | "apps" | "documents" | "people" | "requests" = "all") =>
  searchWorkhubReferenceCatalog(role, "authorized-demo-principal", "test", text, category);

test("WORKHUB #305 search reuses current role-authorized sources, never hidden document hints", async () => {
  const employee = await search("employee", "インシデント");
  assert.deepEqual(employee, [], "an unauthorized document cannot leak its existence in search");
  const manager = await search("manager", "インシデント");
  assert.equal(manager.length, 1);
  assert.equal(manager[0]?.resourceType, "workhub_document");
  assert.equal(manager[0]?.title, "管理者向けインシデント対応（デモ）");
  assert.ok(manager.every(item => !JSON.stringify(item).includes("allowedRoles")));
  assert.deepEqual(await search("missing_role", "社員"), []);
});

test("facet returns only the selected category and safe navigation targets", async () => {
  const documents = await search("employee", "出張", "documents");
  assert.ok(documents.length > 0);
  assert.ok(documents.every(item => item.category === "documents" && item.actionTarget === "/#workhub-documents"));
  assert.ok(documents.some(item => item.snippet?.startsWith("旧版・")));
  assert.deepEqual(await search("employee", "出張", "people"), []);
  const person = await search("employee", "Ren", "people");
  assert.equal(person.length, 1);
  assert.equal(person[0]?.actionTarget, "/#workhub-people");
  const raw = JSON.stringify(person);
  assert.doesNotMatch(raw, /workhub-demo-|Workhub-Demo-2026!|password|email|phone|userId/iu);
  const apps = await search("employee", "出張", "apps");
  assert.ok(apps.some(item => item.resourceType === "workhub_app"));
  assert.ok(apps.every(item => item.category === "apps"));
  assert.deepEqual(await search("employee", "出張", "requests"), []);
});

test("ranking orders authorized official > procedure > FAQ and discourages old or stale documents", async () => {
  const results = await search("manager", "デモ", "documents");
  const ordered = rankWorkhubUnifiedResults(results, "デモ");
  const firstOfficial = ordered.findIndex(x => x.officiality === "official");
  const firstProcedure = ordered.findIndex(x => x.officiality === "procedure" && !x.snippet?.startsWith("旧版"));
  const firstFaq = ordered.findIndex(x => x.officiality === "faq");
  assert.ok(firstOfficial >= 0 && firstProcedure >= 0 && firstFaq >= 0);
  assert.ok(firstOfficial < firstProcedure);
  assert.ok(firstProcedure < firstFaq, "current procedure outranks stale FAQ");
  const legacy = ordered.findIndex(x => x.snippet?.startsWith("旧版・"));
  assert.ok(legacy > firstProcedure, "superseded procedure is not shown as the preferred version");
});

test("the shared SearchApplicationService rejects invalid query inputs", async () => {
  await assert.rejects(search("employee", "\u0001"), { code: "invalid_query" });
  await assert.rejects(search("employee", "x".repeat(513)), { code: "invalid_query" });
});
