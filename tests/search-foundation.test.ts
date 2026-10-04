import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkhubReferenceSearch,
  workhubSearchPrincipal,
} from "../src/reference/workhub/search";
import {
  InMemorySearchProvider,
  SearchApplicationService,
  SearchRequestError,
  type SearchAuthorizationService,
  type SearchResultHydrator,
} from "../src/worker/search";

const principal = { principalId: "user-a", environment: "test" } as const;

const provider = new InMemorySearchProvider([
  {
    resourceType: "travel_request",
    resourceId: "travel-visible",
    category: "requests",
    title: "Tokyo business trip",
    text: "approved travel request",
  },
  {
    resourceType: "travel_request",
    resourceId: "travel-hidden",
    category: "requests",
    title: "Tokyo confidential trip",
    text: "approved travel request",
  },
]);

const authorization: SearchAuthorizationService = {
  async authorizeBatch(input) {
    return input.candidates.map((candidate) => ({
      resourceType: candidate.resourceType,
      resourceId: candidate.resourceId,
      allowed: candidate.resourceId === "travel-visible",
    }));
  },
};

test("search authorizes candidates before hydration and never returns unauthorized resources", async () => {
  let hydratedIds: readonly string[] = [];
  const hydrator: SearchResultHydrator = {
    async hydrateBatch(input) {
      hydratedIds = input.candidates.map((candidate) => candidate.resourceId);
      return input.candidates.map((candidate) => ({
        resourceType: candidate.resourceType,
        resourceId: candidate.resourceId,
        category: candidate.category,
        title: "Authorized current title",
      }));
    },
  };

  const service = new SearchApplicationService(provider, authorization, hydrator);
  const result = await service.search(principal, { text: "Tokyo", categories: ["requests"] });

  assert.deepEqual(hydratedIds, ["travel-visible"]);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.resourceId, "travel-visible");
});

test("hydrator cannot smuggle a result that was not authorized", async () => {
  const hydrator: SearchResultHydrator = {
    async hydrateBatch(input) {
      const candidate = input.candidates[0];
      assert.ok(candidate);
      return [
        {
          resourceType: candidate.resourceType,
          resourceId: candidate.resourceId,
          category: candidate.category,
          title: "Visible",
        },
        {
          resourceType: "document",
          resourceId: "rogue",
          category: "documents",
          title: "Must not escape",
        },
      ];
    },
  };

  const service = new SearchApplicationService(provider, authorization, hydrator);
  const result = await service.search(principal, { text: "Tokyo" });

  assert.deepEqual(result.results.map((item) => item.resourceId), ["travel-visible"]);
});

test("query validation rejects empty, oversized, invalid category, and invalid limit inputs", async () => {
  const hydrator: SearchResultHydrator = { async hydrateBatch() { return []; } };
  const service = new SearchApplicationService(provider, authorization, hydrator);

  const cases = [
    { query: { text: "   " }, code: "invalid_query" },
    { query: { text: "x".repeat(513) }, code: "invalid_query" },
    { query: { text: "Tokyo", categories: ["Invalid Category"] }, code: "invalid_category" },
    { query: { text: "Tokyo", limit: 101 }, code: "invalid_limit" },
  ] as const;

  for (const entry of cases) {
    await assert.rejects(
      () => service.search(principal, entry.query),
      (error: unknown) => error instanceof SearchRequestError && error.code === entry.code,
    );
  }
});

test("in-memory provider applies category filter deterministically", async () => {
  const mixed = new InMemorySearchProvider([
    { resourceType: "document", resourceId: "doc-1", category: "documents", title: "Travel policy" },
    { resourceType: "app", resourceId: "app-1", category: "apps", title: "Travel app" },
  ]);

  const result = await mixed.search({
    principal,
    query: { text: "Travel", categories: ["documents"], limit: 20 },
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.resourceId), ["doc-1"]);
});

test("WORKHUB reference search applies current principal authorization", async () => {
  const service = createWorkhubReferenceSearch();

  const aoi = await service.search(workhubSearchPrincipal("aoi"), { text: "Tokyo" });
  const ren = await service.search(workhubSearchPrincipal("ren"), { text: "Tokyo" });

  assert.deepEqual(aoi.results.map((result) => result.resourceId), ["travel-aoi-tokyo"]);
  assert.deepEqual(
    ren.results.map((result) => result.resourceId).sort(),
    ["travel-aoi-tokyo", "travel-other-tokyo"],
  );
});
