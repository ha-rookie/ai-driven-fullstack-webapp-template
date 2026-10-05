import assert from "node:assert/strict";
import test from "node:test";

import {
  applySearchIndexProjection,
  createSearchIndexProjectionJobEnvelope,
  mapAggregateIntegrationEventToSearchIndexKey,
  reconcileSearchIndexPage,
  type SearchIndexDocument,
  type SearchIndexProjector,
  type SearchIndexReader,
  type SearchIndexWriter,
} from "../src/worker/search";
import type { IntegrationEventRecord } from "../src/worker/integration-event";

class MemoryIndex implements SearchIndexReader, SearchIndexWriter {
  readonly documents = new Map<string, SearchIndexDocument>();
  private key(environment: string, resourceType: string, resourceId: string): string {
    return `${environment}:${resourceType}:${resourceId}`;
  }
  async upsert(document: SearchIndexDocument): Promise<void> {
    this.documents.set(this.key(document.environment, document.resourceType, document.resourceId), document);
  }
  async tombstone(input: {
    readonly environment: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly sourceVersion: string;
    readonly sourceUpdatedAt: string;
    readonly indexedAt: string;
  }): Promise<void> {
    this.documents.set(this.key(input.environment, input.resourceType, input.resourceId), {
      environment: input.environment,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      category: "",
      title: "",
      sourceVersion: input.sourceVersion,
      sourceUpdatedAt: input.sourceUpdatedAt,
      indexedAt: input.indexedAt,
      tombstonedAt: input.indexedAt,
    });
  }
  async get(input: { readonly environment: string; readonly resourceType: string; readonly resourceId: string }): Promise<SearchIndexDocument | null> {
    return this.documents.get(this.key(input.environment, input.resourceType, input.resourceId)) ?? null;
  }
}

const document: SearchIndexDocument = {
  environment: "test",
  resourceType: "travel_request",
  resourceId: "travel-1",
  category: "requests",
  title: "Tokyo business trip",
  text: "Aoi business trip",
  keywords: ["Tokyo", "travel"],
  sourceVersion: "2",
  sourceUpdatedAt: "2026-10-05T00:00:00.000Z",
  indexedAt: "2026-10-05T00:00:00.000Z",
};

test("integration event mapping emits only a resource key for accepted aggregate types", () => {
  const event: IntegrationEventRecord = {
    id: "event-1",
    environment: "test",
    eventType: "travel.updated",
    schemaVersion: 1,
    aggregateType: "travel_request",
    aggregateId: "travel-1",
    occurredAt: "2026-10-05T00:00:00.000Z",
    correlationId: null,
    causationId: null,
    payload: { purpose: "must not be copied into index job payload" },
    createdAt: "2026-10-05T00:00:00.000Z",
  };

  assert.deepEqual(
    mapAggregateIntegrationEventToSearchIndexKey(event, new Set(["travel_request"])),
    { environment: "test", resourceType: "travel_request", resourceId: "travel-1" },
  );
  assert.equal(mapAggregateIntegrationEventToSearchIndexKey(event, new Set(["purchase_request"])), null);
});

test("search index async job envelope contains only the resource key", async () => {
  const envelope = await createSearchIndexProjectionJobEnvelope({
    key: { environment: "test", resourceType: "travel_request", resourceId: "travel-1" },
  });

  assert.equal(envelope.type, "search.index_projection");
  assert.deepEqual(envelope.payload, {
    environment: "test",
    resourceType: "travel_request",
    resourceId: "travel-1",
  });
  assert.equal(JSON.stringify(envelope.payload).includes("business trip"), false);
});

test("reconciliation repairs missing or stale index entries from current source projection", async () => {
  const index = new MemoryIndex();
  await index.upsert({ ...document, sourceVersion: "1", sourceUpdatedAt: "2026-10-04T00:00:00.000Z" });

  const projector: SearchIndexProjector = {
    async project() {
      return { kind: "upsert", document };
    },
  };

  const result = await reconcileSearchIndexPage({
    environment: "test",
    cursor: null,
    limit: 10,
    source: {
      async listKeys() {
        return {
          keys: [{ environment: "test", resourceType: "travel_request", resourceId: "travel-1" }],
          nextCursor: null,
        };
      },
    },
    reader: index,
    writer: index,
    projector,
    now: "2026-10-05T00:01:00.000Z",
  });

  assert.deepEqual(result, { scanned: 1, repaired: 1, missingProjection: 0, nextCursor: null });
  assert.equal((await index.get(document))?.sourceVersion, "2");
});

test("tombstone projection removes a resource from the active index without deleting its index record", async () => {
  const index = new MemoryIndex();
  await index.upsert(document);

  await applySearchIndexProjection({
    projection: {
      kind: "tombstone",
      key: { environment: "test", resourceType: "travel_request", resourceId: "travel-1" },
      sourceVersion: "3",
      sourceUpdatedAt: "2026-10-05T00:02:00.000Z",
    },
    writer: index,
    indexedAt: "2026-10-05T00:03:00.000Z",
  });

  const stored = await index.get(document);
  assert.equal(stored?.sourceVersion, "3");
  assert.equal(stored?.tombstonedAt, "2026-10-05T00:03:00.000Z");
});
