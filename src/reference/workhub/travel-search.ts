import type { SearchIndexDocument, SearchIndexProjector, SearchIndexResourceKey } from "../../worker/search";
import { WORKHUB_TRAVEL_RESOURCE_TYPE } from "./travel-request";
import type { TravelRequestStore } from "./travel-request";

export const WORKHUB_TRAVEL_SEARCH_CATEGORY = "requests";

export class WorkhubTravelSearchProjector implements SearchIndexProjector {
  constructor(
    private readonly store: TravelRequestStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async project(key: SearchIndexResourceKey) {
    if (key.resourceType !== WORKHUB_TRAVEL_RESOURCE_TYPE) return null;

    const request = await this.store.get(key.resourceId, key.environment);
    if (!request) {
      return {
        kind: "tombstone" as const,
        key,
        sourceVersion: "missing",
        sourceUpdatedAt: this.now(),
      };
    }

    const document: SearchIndexDocument = {
      environment: request.environment,
      resourceType: WORKHUB_TRAVEL_RESOURCE_TYPE,
      resourceId: request.id,
      category: WORKHUB_TRAVEL_SEARCH_CATEGORY,
      title: request.purpose,
      text: [request.purpose, request.startDate, request.endDate].join(" "),
      keywords: [request.status],
      sourceVersion: String(request.version),
      sourceUpdatedAt: request.updatedAt,
      indexedAt: this.now(),
    };

    return { kind: "upsert" as const, document };
  }
}
