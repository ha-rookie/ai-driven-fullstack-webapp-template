import assert from "node:assert/strict";
import test from "node:test";
import {
  developerArchitectureLayers, developerCapabilityMap, developerGuideLinkableScreen, developerGuideScenarios, developerAdapterMap,
} from "../src/reference/workhub/developer-guide";
import { developerScreens, developerSourceUrl } from "../src/reference/workhub/developer-reference";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

test("Stage6 guide architecture is a human-readable layered diagram, not business data", () => {
  assert.deepEqual(developerArchitectureLayers.map(x => x.id), ["ui", "application", "domain", "projections", "adapters"]);
  for (const item of developerArchitectureLayers) {
    assert.ok(item.ja && item.en && item.detailJa && item.detailEn);
  }
  assert.doesNotMatch(JSON.stringify(developerArchitectureLayers), /cookie|token:|password:|authorization: Bearer/i);
});

test("Capability Map is derived exclusively from registered screen metadata", () => {
  const capabilities = developerCapabilityMap();
  assert.ok(capabilities.length > 8);
  assert.equal(new Set(capabilities.map(x => x.id)).size, capabilities.length);
  for (const entry of capabilities) {
    assert.ok(entry.screens.length > 0);
    for (const id of entry.screens) {
      assert.equal(developerGuideLinkableScreen(id), true);
      assert.ok(developerScreens.find(x => x.id === id)?.capabilities.includes(entry.id));
    }
  }
  assert.equal(capabilities.find(x => x.id === "Human Workflow")?.screens.includes("requests"), true);
});

test("Scenario Guide marks non-working catalog examples explicitly and links only real screen entries", () => {
  assert.equal(new Set(developerGuideScenarios.map(x => x.id)).size, developerGuideScenarios.length);
  const request = developerGuideScenarios.find(x => x.id === "travel-request-settlement");
  assert.equal(request?.kind, "implemented-reference");
  assert.deepEqual(request?.screens, ["requests", "request-detail", "my-work", "notifications", "expenses", "ask-cecil"]);
  const conceptual = developerGuideScenarios.filter(x => x.kind === "catalog-only");
  assert.ok(conceptual.length > 0);
  assert.ok(conceptual.every(x => x.screens.length === 0));
  for (const scenario of developerGuideScenarios) {
    assert.ok(scenario.ja && scenario.en && scenario.personaJa && scenario.personaEn);
    assert.ok(scenario.screens.every(developerGuideLinkableScreen));
  }
  assert.match(developerSourceUrl("docs/reference/WORKHUB_DEVELOPER_GUIDE.md") ?? "", /^https:\/\/github.com\/ha-rookie\//);
});

test("Adapter catalog links to screens and mock journeys are not marked production-ready", () => {
  const adapterMap = developerAdapterMap();
  assert.ok(adapterMap.length >= 2);
  assert.ok(adapterMap.every(x => developerGuideLinkableScreen(x.screen) && x.view && x.owner));
  const mock = developerGuideScenarios.filter(x => x.kind === "reference-mock");
  assert.deepEqual(mock.map(x => x.id), ["moving-reference", "pc-replacement-reference"]);
  assert.ok(mock.every(x => x.screens.includes("secondary-journeys") && x.noteJa.includes("実") || x.noteJa.includes("デモ")));
});


test("#350 recovery scenario remains partial and points to real evidence without claiming System Test", () => {
  const scenario = developerGuideScenarios.find(item => item.id === "scenario.workhub.error-recovery");
  assert.ok(scenario, "missing #350 recovery scenario");
  assert.equal(scenario.kind, "partial-reference");
  assert.ok(scenario.screens.includes("my-work") && scenario.screens.includes("search"));
  assert.equal(scenario.evidenceDoc, "docs/reference/WORKHUB_ERROR_RECOVERY_ACCEPTANCE.md");
  assert.equal(existsSync(resolve(process.cwd(), scenario.evidenceDoc!)), true);
  assert.match(developerSourceUrl(scenario.evidenceDoc!) ?? "", /^https:\/\/github\.com\/ha-rookie\//);
  assert.match(scenario.noteJa, /未完了/);
  assert.match(scenario.noteEn, /incomplete/);
  assert.ok(developerGuideScenarios.filter(item => item.kind === "catalog-only").every(item => item.screens.length === 0));
});
