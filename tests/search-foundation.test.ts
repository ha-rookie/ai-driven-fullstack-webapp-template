import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkhubReferenceSearch,
  workhubSearchPrincipal,
} from "../src/reference/workhub/search";
import {
  InMemorySearchCursorCodec,
  InMemorySearchProvider,
  CategoryFanoutSearchProvider,
  SearchApplicationService,
  SearchRequestError,
  type SearchAuthorizationService,
  type SearchProvider,
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

const newService = (hydrator: SearchResultHydrator): SearchApplicationService =>
  new SearchApplicationService(provider, authorization, hydrator, new InMemorySearchCursorCodec());

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

  const result = await newService(hydrator).search(principal, { text: "Tokyo", categories: ["requests"] });

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

  const result = await newService(hydrator).search(principal, { text: "Tokyo" });

  assert.deepEqual(result.results.map((item) => item.resourceId), ["travel-visible"]);
});

test("query validation rejects empty, oversized, invalid category, and invalid limit inputs", async () => {
  const hydrator: SearchResultHydrator = { async hydrateBatch() { return []; } };
  const service = newService(hydrator);

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

test("opaque cursor hides provider cursor and restores it only for the same search binding", async () => {
  const receivedCursors: Array<string | undefined> = [];
  const pagingProvider: SearchProvider = {
    async search(input) {
      receivedCursors.push(input.query.cursor);
      return {
        candidates: [],
        nextCursor: input.query.cursor ? null : "provider-secret-token",
      };
    },
  };
  const allowAll: SearchAuthorizationService = { async authorizeBatch() { return []; } };
  const noHydration: SearchResultHydrator = { async hydrateBatch() { return []; } };
  const service = new SearchApplicationService(
    pagingProvider,
    allowAll,
    noHydration,
    new InMemorySearchCursorCodec(),
  );

  const first = await service.search(principal, { text: "Tokyo", categories: ["requests"] });
  assert.ok(first.nextCursor);
  assert.notEqual(first.nextCursor, "provider-secret-token");
  assert.equal(first.nextCursor.includes("provider-secret-token"), false);

  await service.search(principal, {
    text: "Tokyo",
    categories: ["requests"],
    cursor: first.nextCursor,
  });
  assert.deepEqual(receivedCursors, [undefined, "provider-secret-token"]);
});

test("opaque cursor rejects reuse after query or principal changes", async () => {
  const pagingProvider: SearchProvider = {
    async search() {
      return { candidates: [], nextCursor: "provider-token" };
    },
  };
  const service = new SearchApplicationService(
    pagingProvider,
    { async authorizeBatch() { return []; } },
    { async hydrateBatch() { return []; } },
    new InMemorySearchCursorCodec(),
  );
  const first = await service.search(principal, { text: "Tokyo", categories: ["requests"] });
  assert.ok(first.nextCursor);

  await assert.rejects(
    () => service.search(principal, { text: "Osaka", categories: ["requests"], cursor: first.nextCursor ?? undefined }),
    (error: unknown) => error instanceof SearchRequestError && error.code === "invalid_cursor",
  );
  await assert.rejects(
    () => service.search({ principalId: "user-b", environment: "test" }, {
      text: "Tokyo",
      categories: ["requests"],
      cursor: first.nextCursor ?? undefined,
    }),
    (error: unknown) => error instanceof SearchRequestError && error.code === "invalid_cursor",
  );
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

test("category fan-out keeps successful categories and reports failed categories separately", async () => {
  const documents = new InMemorySearchProvider([
    { resourceType: "document", resourceId: "doc-1", category: "documents", title: "Travel policy" },
  ]);
  const failing: SearchProvider = { async search() { throw new Error("provider down"); } };
  const fanout = new CategoryFanoutSearchProvider({ documents, apps: failing });
  const service = new SearchApplicationService(
    fanout,
    { async authorizeBatch(input) { return input.candidates.map((candidate) => ({resourceType:candidate.resourceType,resourceId:candidate.resourceId,allowed:true})); } },
    { async hydrateBatch(input) { return input.candidates.map((candidate) => ({...candidate,title:"Current travel policy"})); } },
    new InMemorySearchCursorCodec(),
  );
  const result = await service.search(principal,{text:"Travel",categories:["documents","apps"]});
  assert.deepEqual(result.results.map((item)=>item.resourceId),["doc-1"]);
  assert.deepEqual(result.categoryFailures,[{category:"apps",code:"provider_error"}]);
});

test("missing category provider is not misreported as zero results", async () => {
  const fanout = new CategoryFanoutSearchProvider({
    documents:new InMemorySearchProvider([]),
  });
  const service = new SearchApplicationService(
    fanout,
    { async authorizeBatch(){return [];} },
    { async hydrateBatch(){return [];} },
    new InMemorySearchCursorCodec(),
  );
  const result=await service.search(principal,{text:"Travel",categories:["documents","people"]});
  assert.deepEqual(result.results,[]);
  assert.deepEqual(result.categoryFailures,[{category:"people",code:"provider_unavailable"}]);
});

test("result projection masks sensitive hydrated fields after current authorization", async () => {
  const multi = new InMemorySearchProvider([
    { resourceType:"document",resourceId:"doc-1",category:"documents",title:"Travel policy" },
    { resourceType:"app",resourceId:"app-1",category:"apps",title:"Travel app" },
  ]);
  const service = new SearchApplicationService(
    multi,
    { async authorizeBatch(input){return input.candidates.map((candidate)=>({resourceType:candidate.resourceType,resourceId:candidate.resourceId,allowed:true}));} },
    { async hydrateBatch(input){return input.candidates.map((candidate)=>({...candidate,title:candidate.resourceType==="document"?"Travel policy — HR confidential":"Travel app",snippet:"internal-sensitive-snippet"}));} },
    new InMemorySearchCursorCodec(),
    { project({result}) { return {...result,title:result.title.replace(" — HR confidential",""),snippet:undefined}; } },
  );
  const result=await service.search(principal,{text:"Travel"});
  assert.deepEqual(result.results.map((item)=>item.resourceType).sort(),["app","document"]);
  assert.equal(result.results.some((item)=>item.title.includes("confidential")),false);
  assert.equal(result.results.some((item)=>item.snippet!==undefined),false);
});
