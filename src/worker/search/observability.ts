import type { ApplicationMetricsRecorder } from "../../shared/observability";
import type { SearchPrincipal, SearchQuery, SearchResponse } from "./types";

export interface SearchObservation {
  readonly environment: string;
  readonly categoryCount: number;
  readonly resultCount: number;
  readonly failedCategoryCount: number;
  readonly hasCursor: boolean;
}

export type SearchObservationSink = (observation: SearchObservation) => void;

export const createSearchObservation = (
  principal: SearchPrincipal,
  query: SearchQuery,
  response: SearchResponse,
): SearchObservation => Object.freeze({
  environment: principal.environment,
  categoryCount: query.categories?.length ?? 0,
  resultCount: response.results.length,
  failedCategoryCount: response.categoryFailures?.length ?? 0,
  hasCursor: Boolean(response.nextCursor),
});

export const recordSearchProviderFailure = (
  metrics: ApplicationMetricsRecorder,
  requestId?: string,
): void => {
  metrics.recordDependencyFailure({
    dependency: "search_provider",
    operation: "search",
    requestId,
  });
};
