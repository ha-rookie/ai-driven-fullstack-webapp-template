import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkhubAiSearchContextBuilder,
  createWorkhubSharedSearchConsumer,
  workhubSearchPrincipal,
} from "../src/reference/workhub/search";
import {
  AiSearchContextBuilder,
  CategoryFanoutSearchProvider,
  InMemorySearchCursorCodec,
  InMemorySearchProvider,
  SearchApplicationService,
  SharedSearchConsumer,
  type SearchAuthorizationService,
  type SearchProvider,
  type SearchResultHydrator,
} from "../src/worker/search";

test("web and AI consumers reuse the same WORKHUB SearchApplicationService boundary", async () => {
  const consumer = createWorkhubSharedSearchConsumer();
  const web = await consumer.search({
    consumer: "web",
    principal: workhubSearchPrincipal("aoi"),
    query: { text: "Tokyo" },
  });
  const ai = await createWorkhubAiSearchContextBuilder().build(
    workhubSearchPrincipal("aoi"),
    { text: "Tokyo" },
  );

  assert.deepEqual(web.results.map((item) => item.resourceId), ["travel-aoi-tokyo"]);
  assert.deepEqual(ai.items.map((item) => item.resourceId), ["travel-aoi-tokyo"]);
  assert.equal(ai.items.some((item) => item.resourceId === "travel-other-tokyo"), false);
});

test("MCP consumer mode uses the same service and current authorization", async () => {
  const consumer = createWorkhubSharedSearchConsumer();
  const aoi = await consumer.search({
    consumer: "mcp",
    principal: workhubSearchPrincipal("aoi"),
    query: { text: "Tokyo" },
  });
  const ren = await consumer.search({
    consumer: "mcp",
    principal: workhubSearchPrincipal("ren"),
    query: { text: "Tokyo" },
  });

  assert.deepEqual(aoi.results.map((item) => item.resourceId), ["travel-aoi-tokyo"]);
  assert.deepEqual(ren.results.map((item) => item.resourceId).sort(), ["travel-aoi-tokyo", "travel-other-tokyo"]);
});

test("permission change is reflected immediately in AI context without trusting index candidates", async () => {
  let allowed = true;
  const provider = new InMemorySearchProvider([
    { resourceType: "document", resourceId: "policy-1", category: "documents", title: "Remote work policy" },
  ]);
  const authorization: SearchAuthorizationService = {
    async authorizeBatch(input) {
      return input.candidates.map((candidate) => ({
        resourceType: candidate.resourceType,
        resourceId: candidate.resourceId,
        allowed,
      }));
    },
  };
  const hydrator: SearchResultHydrator = {
    async hydrateBatch(input) {
      return input.candidates.map((candidate) => ({
        ...candidate,
        title: "Current remote work policy",
        snippet: "current safe content",
      }));
    },
  };
  const builder = new AiSearchContextBuilder(
    new SharedSearchConsumer(
      new SearchApplicationService(provider, authorization, hydrator, new InMemorySearchCursorCodec()),
    ),
  );

  const before = await builder.build({ principalId: "aoi", environment: "test" }, { text: "Remote" });
  allowed = false;
  const after = await builder.build({ principalId: "aoi", environment: "test" }, { text: "Remote" });

  assert.equal(before.items.length, 1);
  assert.equal(after.items.length, 0);
});

test("AI context contains only projected masked results and preserves category failures", async () => {
  const documents = new InMemorySearchProvider([
    { resourceType: "document", resourceId: "policy-1", category: "documents", title: "Remote policy" },
  ]);
  const failed: SearchProvider = { async search() { throw new Error("down"); } };
  const provider = new CategoryFanoutSearchProvider({ documents, people: failed });
  const service = new SearchApplicationService(
    provider,
    { async authorizeBatch(input) { return input.candidates.map((candidate) => ({ resourceType: candidate.resourceType, resourceId: candidate.resourceId, allowed: true })); } },
    { async hydrateBatch(input) { return input.candidates.map((candidate) => ({ ...candidate, title: "Remote policy — confidential", snippet: "secret" })); } },
    new InMemorySearchCursorCodec(),
    { project({ result }) { return { ...result, title: "Remote policy", snippet: undefined }; } },
  );
  const context = await new AiSearchContextBuilder(new SharedSearchConsumer(service)).build(
    { principalId: "aoi", environment: "test" },
    { text: "Remote", categories: ["documents", "people"] },
  );

  assert.deepEqual(context.items.map((item) => item.title), ["Remote policy"]);
  assert.equal(context.items[0]?.snippet, undefined);
  assert.deepEqual(context.categoryFailures, [{ category: "people", code: "provider_error" }]);
});
