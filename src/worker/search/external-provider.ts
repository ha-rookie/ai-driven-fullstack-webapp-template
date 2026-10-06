import type {
  SearchCandidate,
  SearchPrincipal,
  SearchProvider,
  SearchProviderResult,
  SearchQuery,
} from "./types";

export interface ExternalSearchHit {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly category: string;
  readonly score?: number;
}

export interface ExternalSearchPage {
  readonly hits: readonly ExternalSearchHit[];
  readonly cursor: string | null;
}

export interface ExternalSearchClient {
  search(input: {
    readonly text: string;
    readonly categories?: readonly string[];
    readonly cursor?: string;
    readonly limit: number;
    readonly environment: string;
  }): Promise<ExternalSearchPage>;
}

export class ExternalSearchProvider implements SearchProvider {
  constructor(private readonly client: ExternalSearchClient) {}

  async search(input: {
    readonly query: SearchQuery;
    readonly principal: SearchPrincipal;
  }): Promise<SearchProviderResult> {
    const page = await this.client.search({
      text: input.query.text,
      categories: input.query.categories,
      cursor: input.query.cursor,
      limit: input.query.limit ?? 20,
      environment: input.principal.environment,
    });
    const candidates: SearchCandidate[] = page.hits.map((hit) => ({
      resourceType: hit.resourceType,
      resourceId: hit.resourceId,
      category: hit.category,
      ...(hit.score !== undefined ? { providerScore: hit.score } : {}),
    }));
    return { candidates, nextCursor: page.cursor };
  }
}

export interface VectorSearchClient extends ExternalSearchClient {}

export class VectorSearchProvider extends ExternalSearchProvider {
  constructor(client: VectorSearchClient) {
    super(client);
  }
}
