import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
  assert.equal(developerScreens.length, 13);
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
      assert.equal(existsSync(resolve(process.cwd(), path)), true, `Broken Source/Docs reference: ${path}`);
    }
  }
  assert.equal(developerSourceUrl("../src/App.tsx"), null);
  assert.equal(developerSourceUrl("https://evil.example/secret"), null);
  assert.equal(developerSourceUrl("wrangler.jsonc"), null);
  assert.equal(developerSourceUrl("src/.env"), null);
});

test("Developer metadata selection uses context but never business values", () => {
  assert.equal(developerScreenFromRoute("#workhub-expenses"), "expenses");
  assert.equal(developerScreenFromRoute("#workhub-announcements"), "announcements");
  assert.equal(developerScreenFromRoute("#workhub-social"), "social");
  assert.equal(developerScreenFromRoute("#workhub-secondary-journeys"), "secondary-journeys");
  assert.equal(developerScreenFromRoute("#workhub-apps"), "apps");
  assert.equal(developerScreenFromRoute("#workhub-request-intents"), "requests");
  assert.equal(developerScreenFromRoute("#workhub-people"), "people");
  assert.equal(developerScreenFromRoute("#workhub-home", true), "notifications");
  assert.equal(developerScreenFromRoute("#workhub-home", false, true), "ask-cecil");
  assert.equal(developerScreenFromRoute("#workhub-unknown"), "home");
});

test("Stage6 coverage of all existing WORKHUB navigation sections distinguishes synthetic adapters", () => {
  for (const id of ["expenses", "announcements", "social", "secondary-journeys"] as const) {
    const screen = findDeveloperScreen(id);
    assert.equal(screen.id, id);
    assert.ok(screen.source.length > 0);
    assert.ok(screen.authorization.length > 25);
    assert.ok(screen.readiness.length > 0);
    assert.ok(screen.limitations.length > 0);
  }
  assert.equal(findDeveloperScreen("secondary-journeys").readiness.some(x => x.state === "mock-adapter"), true);
  assert.equal(findDeveloperScreen("social").readiness.some(x => x.state === "not-implemented"), true);
  assert.equal(findDeveloperScreen("expenses").sourceOfTruth.some(x => x.kind === "domain"), true);
});
