import assert from "node:assert/strict";
import test from "node:test";
import {
  developerArchitectureLayers, developerCapabilityMap, developerGuideLinkableScreen, developerGuideScenarios,
} from "../src/reference/workhub/developer-guide";
import { developerScreens, developerSourceUrl } from "../src/reference/workhub/developer-reference";

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
  assert.deepEqual(request?.screens, ["requests", "my-work", "notifications", "ask-cecil"]);
  const conceptual = developerGuideScenarios.filter(x => x.kind === "catalog-only");
  assert.ok(conceptual.length > 0);
  assert.ok(conceptual.every(x => x.screens.length === 0));
  for (const scenario of developerGuideScenarios) {
    assert.ok(scenario.ja && scenario.en && scenario.personaJa && scenario.personaEn);
    assert.ok(scenario.screens.every(developerGuideLinkableScreen));
  }
  assert.match(developerSourceUrl("docs/reference/WORKHUB_DEVELOPER_GUIDE.md") ?? "", /^https:\/\/github.com\/ha-rookie\//);
});
