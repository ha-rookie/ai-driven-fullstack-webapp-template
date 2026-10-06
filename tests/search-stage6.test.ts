import assert from "node:assert/strict";
import test from "node:test";

import {
  ExternalSearchProvider,
  InMemorySearchCursorCodec,
  SearchApplicationService,
  VectorSearchProvider,
  createSearchObservation,
  mapAggregateIntegrationEventToSearchIndexKey,
  mapIntegrationEventToSearchProjectionJob,
  type ExternalSearchClient,
  type SearchAuthorizationService,
  type SearchResultHydrator,
} from "../src/worker/search";
import type { IntegrationEventRecord } from "../src/worker/integration-event";

const principal = { principalId: "aoi", environment: "test" } as const;

const client: ExternalSearchClient = {
  async search() {
    return {
      hits: [{ resourceType: "document", resourceId: "doc-1", category: "documents", score: 0.92 }],
      cursor: "external-private-cursor",
    };
  },
};

test("external and vector adapters expose only provider-neutral candidates", async () => {
  for (const provider of [new ExternalSearchProvider(client), new VectorSearchProvider(client)]) {
    const page = await provider.search({ principal, query: { text: "sensitive payroll phrase", limit: 10 } });
    assert.deepEqual(page.candidates, [{
      resourceType: "document",
      resourceId: "doc-1",
      category: "documents",
      providerScore: 0.92,
    }]);
    assert.equal(page.nextCursor, "external-private-cursor");
    assert.equal(JSON.stringify(page.candidates).includes("sensitive payroll phrase"), false);
  }
});

test("search observability never contains raw query text", () => {
  const observation = createSearchObservation(
    principal,
    { text: "employee salary secret", categories: ["documents"] },
    { results: [], nextCursor: null, categoryFailures: [{ category: "documents", code: "provider_error" }] },
  );
  assert.deepEqual(observation, {
    environment: "test",
    categoryCount: 1,
    resultCount: 0,
    failedCategoryCount: 1,
    hasCursor: false,
  });
  assert.equal(JSON.stringify(observation).includes("salary"), false);
  assert.equal("text" in observation, false);
});

test("integration event maps to #51 search projection job without business payload", async () => {
  const event: IntegrationEventRecord = {
    id: "evt-1",
    environment: "test",
    eventType: "travel_request.updated",
    schemaVersion: 1,
    aggregateType: "travel_request",
    aggregateId: "travel-1",
    occurredAt: "2026-10-06T00:00:00.000Z",
    correlationId: "corr-1",
    causationId: null,
    payload: { confidentialPurpose: "must-not-enter-job" },
    createdAt: "2026-10-06T00:00:00.000Z",
  };
  const envelope = await mapIntegrationEventToSearchProjectionJob({
    event,
    mapper: {
      map(source) {
        return mapAggregateIntegrationEventToSearchIndexKey(source, new Set(["travel_request"]));
      },
    },
  });
  assert.ok(envelope);
  assert.equal(envelope.type, "search.index_projection");
  assert.deepEqual(envelope.payload, { environment: "test", resourceType: "travel_request", resourceId: "travel-1" });
  assert.equal(JSON.stringify(envelope).includes("must-not-enter-job"), false);
});

test("authorization and hydration remain one batch each for many provider candidates", async () => {
  const manyClient: ExternalSearchClient = {
    async search() {
      return {
        hits: Array.from({ length: 50 }, (_, index) => ({
          resourceType: "document",
          resourceId: `doc-${index}`,
          category: "documents",
        })),
        cursor: null,
      };
    },
  };
  let authorizationCalls = 0;
  let hydrationCalls = 0;
  const authorization: SearchAuthorizationService = {
    async authorizeBatch(input) {
      authorizationCalls += 1;
      return input.candidates.map((candidate) => ({
        resourceType: candidate.resourceType,
        resourceId: candidate.resourceId,
        allowed: true,
      }));
    },
  };
  const hydrator: SearchResultHydrator = {
    async hydrateBatch(input) {
      hydrationCalls += 1;
      return input.candidates.map((candidate) => ({ ...candidate, title: candidate.resourceId }));
    },
  };
  const service = new SearchApplicationService(
    new ExternalSearchProvider(manyClient),
    authorization,
    hydrator,
    new InMemorySearchCursorCodec(),
  );
  const response = await service.search(principal, { text: "policy", limit: 50 });
  assert.equal(response.results.length, 50);
  assert.equal(authorizationCalls, 1);
  assert.equal(hydrationCalls, 1);
});
