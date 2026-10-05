import type { IntegrationEventRecord } from "../integration-event";
import type { SearchIndexDocument, SearchIndexReader, SearchIndexWriter } from "./index-document";

export interface SearchIndexResourceKey {
  readonly environment: string;
  readonly resourceType: string;
  readonly resourceId: string;
}

export type SearchIndexProjection =
  | { readonly kind: "upsert"; readonly document: SearchIndexDocument }
  | {
      readonly kind: "tombstone";
      readonly key: SearchIndexResourceKey;
      readonly sourceVersion: string;
      readonly sourceUpdatedAt: string;
    };

export interface SearchIndexProjector {
  project(key: SearchIndexResourceKey): Promise<SearchIndexProjection | null>;
}

export interface SearchIndexIntegrationEventMapper {
  map(event: IntegrationEventRecord): SearchIndexResourceKey | null;
}

export const mapAggregateIntegrationEventToSearchIndexKey = (
  event: IntegrationEventRecord,
  acceptedAggregateTypes: ReadonlySet<string>,
): SearchIndexResourceKey | null => {
  if (!event.aggregateType || !event.aggregateId || !acceptedAggregateTypes.has(event.aggregateType)) return null;
  return {
    environment: event.environment,
    resourceType: event.aggregateType,
    resourceId: event.aggregateId,
  };
};

export const applySearchIndexProjection = async (input: {
  readonly projection: SearchIndexProjection;
  readonly writer: SearchIndexWriter;
  readonly indexedAt: string;
}): Promise<void> => {
  if (input.projection.kind === "upsert") {
    await input.writer.upsert({ ...input.projection.document, indexedAt: input.indexedAt });
    return;
  }
  await input.writer.tombstone({
    ...input.projection.key,
    sourceVersion: input.projection.sourceVersion,
    sourceUpdatedAt: input.projection.sourceUpdatedAt,
    indexedAt: input.indexedAt,
  });
};

export interface SearchIndexReconciliationSource {
  listKeys(input: {
    readonly environment: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<{ readonly keys: readonly SearchIndexResourceKey[]; readonly nextCursor: string | null }>;
}

export interface SearchIndexReconciliationResult {
  readonly scanned: number;
  readonly repaired: number;
  readonly missingProjection: number;
}

export const reconcileSearchIndexPage = async (input: {
  readonly environment: string;
  readonly cursor: string | null;
  readonly limit: number;
  readonly source: SearchIndexReconciliationSource;
  readonly reader: SearchIndexReader;
  readonly writer: SearchIndexWriter;
  readonly projector: SearchIndexProjector;
  readonly now: string;
}): Promise<SearchIndexReconciliationResult & { readonly nextCursor: string | null }> => {
  const page = await input.source.listKeys({ environment: input.environment, cursor: input.cursor, limit: input.limit });
  let repaired = 0;
  let missingProjection = 0;

  for (const key of page.keys) {
    const projection = await input.projector.project(key);
    if (!projection) {
      missingProjection += 1;
      continue;
    }
    const current = await input.reader.get(key);
    const expectedVersion = projection.kind === "upsert" ? projection.document.sourceVersion : projection.sourceVersion;
    const expectedUpdatedAt = projection.kind === "upsert" ? projection.document.sourceUpdatedAt : projection.sourceUpdatedAt;
    const expectedTombstone = projection.kind === "tombstone";
    const stale = !current
      || current.sourceVersion !== expectedVersion
      || current.sourceUpdatedAt !== expectedUpdatedAt
      || Boolean(current.tombstonedAt) !== expectedTombstone;
    if (!stale) continue;
    await applySearchIndexProjection({ projection, writer: input.writer, indexedAt: input.now });
    repaired += 1;
  }

  return { scanned: page.keys.length, repaired, missingProjection, nextCursor: page.nextCursor };
};
