import type { AsyncJobEnvelope } from "../../shared/async-job";
import type { IntegrationEventRecord } from "../integration-event";
import { createSearchIndexProjectionJobEnvelope, type SearchIndexProjectionJobPayload } from "./index-async-job";
import type { SearchIndexIntegrationEventMapper } from "./index-projection";

export const mapIntegrationEventToSearchProjectionJob = async (input: {
  readonly event: IntegrationEventRecord;
  readonly mapper: SearchIndexIntegrationEventMapper;
}): Promise<AsyncJobEnvelope<SearchIndexProjectionJobPayload> | null> => {
  const key = input.mapper.map(input.event);
  if (!key) return null;
  return createSearchIndexProjectionJobEnvelope({
    key,
    correlationId: input.event.correlationId ?? undefined,
  });
};
