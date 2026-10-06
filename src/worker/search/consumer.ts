import type { SearchApplicationService } from "./service";
import type { SearchCategoryFailure, SearchPrincipal, SearchQuery, SearchResult } from "./types";

export type SearchConsumerKind = "web" | "ai_rag" | "mcp";

export interface SearchConsumerRequest {
  readonly consumer: SearchConsumerKind;
  readonly principal: SearchPrincipal;
  readonly query: SearchQuery;
}

export interface SearchConsumerResponse {
  readonly results: readonly SearchResult[];
  readonly nextCursor: string | null;
  readonly categoryFailures: readonly SearchCategoryFailure[];
}

export class SharedSearchConsumer {
  constructor(private readonly searchService: SearchApplicationService) {}

  async search(input: SearchConsumerRequest): Promise<SearchConsumerResponse> {
    const response = await this.searchService.search(input.principal, input.query);
    return {
      results: response.results,
      nextCursor: response.nextCursor,
      categoryFailures: response.categoryFailures ?? [],
    };
  }
}

export interface AiSearchContextItem {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly category: string;
  readonly title: string;
  readonly snippet?: string;
  readonly sourceUpdatedAt?: string;
  readonly officiality?: string;
}

export interface AiSearchContext {
  readonly items: readonly AiSearchContextItem[];
  readonly categoryFailures: readonly SearchCategoryFailure[];
}

export class AiSearchContextBuilder {
  constructor(private readonly consumer: SharedSearchConsumer) {}

  async build(principal: SearchPrincipal, query: SearchQuery): Promise<AiSearchContext> {
    const response = await this.consumer.search({ consumer: "ai_rag", principal, query });
    return {
      items: response.results.map((result) => ({
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        category: result.category,
        title: result.title,
        ...(result.snippet !== undefined ? { snippet: result.snippet } : {}),
        ...(result.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: result.sourceUpdatedAt } : {}),
        ...(result.officiality !== undefined ? { officiality: result.officiality } : {}),
      })),
      categoryFailures: response.categoryFailures,
    };
  }
}
