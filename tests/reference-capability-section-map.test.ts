import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const map = readFileSync("docs/reference/CAPABILITY_SECTION_MAP.md", "utf8");
const site = readFileSync("src/reference/site/ReferenceSite.tsx", "utf8");

const iaSections = new Set([
  "Overview", "Getting Started", "Architecture", "Components",
  "Business Patterns", "Authentication / Authorization", "Security",
  "Files / External Storage", "Jobs / Batch / Retry / Rerun",
  "Observability", "AI / Agent / MCP", "Operations",
  "Admin / Operations Portal", "Reference Application", "Recipes",
  "ADR / Design Decisions", "Roadmap / Capability Status",
]);

const inventory = map.split("\n")
  .filter(line => /^\| C\d{2} \|/u.test(line))
  .map(line => line.split("|").map(field => field.trim()));
const regional = map.split("\n")
  .filter(line => /^\| JP\d{2} \|/u.test(line))
  .map(line => line.split("|").map(field => field.trim()));

test("#433 all original 80 inventory candidates map to existing frozen Reference IA sections", () => {
  assert.equal(inventory.length, 80);
  assert.equal(new Set(inventory.map(row => row[1])).size, 80);
  assert.equal(new Set(inventory.map(row => row[3])).size, 80);
  const domains = new Set(inventory.map(row => row[4]));
  assert.equal(domains.size, 8);
  for (const [i, row] of inventory.entries()) {
    assert.equal(row[1], "C" + String(i + 1).padStart(2, "0"));
    assert.match(row[3], /^#\d+$/u);
    assert.ok(iaSections.has(row[5]), "Unrecognized frozen IA section for " + row[3]);
  }
  assert.ok(map.includes("Issue ≠ Capability"));
  assert.ok(map.includes("台帳のみ"));
});

test("#433 six published capability cards and six Japanese regional children are classified without invented routes", () => {
  const cards = inventory.filter(row => row[6] !== "台帳のみ").map(row => row[6].replaceAll(String.fromCharCode(96), ""));
  assert.deepEqual(new Set(cards), new Set([
    "reference-workflow", "reference-authorization", "reference-recovery",
    "reference-search", "reference-report", "reference-csv",
  ]));
  assert.equal(cards.length, 6);
  const sourceList = site.slice(site.indexOf("const CAPABILITIES:"), site.indexOf("const SCENARIOS ="));
  const sourceIds = [...sourceList.matchAll(/^\s+id: "([^"]+)",/gmu)].map(match => "reference-" + match[1]);
  assert.deepEqual(new Set(cards), new Set(sourceIds));

  assert.equal(regional.length, 6);
  assert.equal(new Set(regional.map(row => row[3])).size, 6);
  for (const [index, row] of regional.entries()) {
    assert.equal(row[1], "JP" + String(index + 1).padStart(2, "0"));
    assert.ok(iaSections.has(row[4]));
    assert.equal(row[5], "台帳のみ");
  }
  assert.ok(map.includes("Preview/Production"));
  assert.ok(map.includes("checkboxが未反映"));
});
