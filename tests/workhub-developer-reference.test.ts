import assert from "node:assert/strict";
import test from "node:test";
import {
  developerScreens, developerScreenFromRoute, developerSourceUrl,
  findDeveloperScreen, isDeveloperReferenceEnvironment,
} from "../src/reference/workhub/developer-reference";

test("Developer Mode is limited to explicit Reference hosts; production disabled", () => {
  assert.equal(isDeveloperReferenceEnvironment("localhost", true), true);
  assert.equal(isDeveloperReferenceEnvironment("127.0.0.1", true), true);
  assert.equal(isDeveloperReferenceEnvironment("ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev", false), true);
  assert.equal(isDeveloperReferenceEnvironment("customer.example", false), false);
  assert.equal(isDeveloperReferenceEnvironment("ai-driven-fullstack-webapp-template.ha-rookie.workers.dev", false), false);
  assert.equal(isDeveloperReferenceEnvironment("evil-localhost.invalid", true), false);
  assert.equal(isDeveloperReferenceEnvironment("ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev.evil", false), false);
});

test("Static reference screen metadata has unique stable IDs, domain vs projection and no leaked values", () => {
  assert.ok(developerScreens.length >= 7);
  assert.equal(new Set(developerScreens.map(x => x.id)).size, developerScreens.length);
  const travel = findDeveloperScreen("requests");
  assert.equal(travel.scenario, "travel-request-settlement");
  assert.ok(travel.sourceOfTruth.some(x => x.kind === "workflow"));
  assert.ok(travel.sourceOfTruth.some(x => x.kind === "domain"));
  assert.ok(travel.sourceOfTruth.some(x => x.kind === "projection"));
  const json = JSON.stringify(developerScreens).toLowerCase();
  for (const forbidden of ['"accesstoken"', '"privatekey"', '"password"', '"sql"', '"userid"', '"requestbody"', '"sessionid"']) {
    assert.equal(json.includes(forbidden), false, forbidden);
  }
  for (const x of developerScreens) {
    assert.ok(x.title.ja && x.title.en);
    assert.ok(x.capabilities.length > 0);
    for (const path of [...x.docs, ...x.source]) {
      const url = developerSourceUrl(path);
      assert.ok(url?.startsWith("https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/blob/main/"));
    }
  }
  assert.equal(developerSourceUrl("../src/App.tsx"), null);
  assert.equal(developerSourceUrl("https://evil.example/secret"), null);
  assert.equal(developerSourceUrl("wrangler.jsonc"), null);
  assert.equal(developerSourceUrl("src/.env"), null);
});

test("Developer metadata selection uses context but never business values", () => {
  assert.equal(developerScreenFromRoute("#workhub-apps"), "apps");
  assert.equal(developerScreenFromRoute("#workhub-request-intents"), "requests");
  assert.equal(developerScreenFromRoute("#workhub-people"), "people");
  assert.equal(developerScreenFromRoute("#workhub-home", true), "notifications");
  assert.equal(developerScreenFromRoute("#workhub-home", false, true), "ask-cecil");
  assert.equal(developerScreenFromRoute("#workhub-unknown"), "home");
});
