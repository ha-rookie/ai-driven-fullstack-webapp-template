import {
  AsyncJobExecutionError,
  createAsyncJobEnvelope,
  type AsyncJobEnvelope,
  type AsyncJobHandler,
} from "../../shared/async-job";
import { systemClock, type Clock, type IdGenerator } from "../../shared/runtime";
import { applySearchIndexProjection, type SearchIndexProjector, type SearchIndexResourceKey } from "./index-projection";
import type { SearchIndexWriter } from "./index-document";

export interface SearchIndexProjectionJobPayload extends SearchIndexResourceKey {}

export const createSearchIndexProjectionJobEnvelope = async (input: {
  readonly key: SearchIndexResourceKey;
  readonly correlationId?: string;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
}): Promise<AsyncJobEnvelope<SearchIndexProjectionJobPayload>> =>
  createAsyncJobEnvelope({
    type: "search.index_projection",
    payload: input.key,
    idempotencyKey: `search-index:${input.key.environment}:${input.key.resourceType}:${input.key.resourceId}`,
    correlationId: input.correlationId,
    clock: input.clock,
    idGenerator: input.idGenerator,
  });

export const createSearchIndexProjectionJobHandler = (input: {
  readonly projector: SearchIndexProjector;
  readonly writer: SearchIndexWriter;
  readonly clock?: Clock;
}): AsyncJobHandler<SearchIndexProjectionJobPayload> => async (payload) => {
  const projection = await input.projector.project(payload);
  if (!projection) {
    throw new AsyncJobExecutionError({ retryable: false, code: "search_projection_missing" });
  }
  await applySearchIndexProjection({
    projection,
    writer: input.writer,
    indexedAt: (input.clock ?? systemClock).now().toISOString(),
  });
};
