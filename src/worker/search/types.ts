export interface SearchQuery {
  readonly text: string;
  readonly categories?: readonly string[];
  readonly cursor?: string;
  readonly limit?: number;
  readonly locale?: string;
}

export interface SearchPrincipal {
  readonly principalId: string;
  readonly environment: string;
}

export interface SearchCandidate {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly category: string;
  readonly providerScore?: number;
  readonly providerCursor?: string;
}

export interface SearchProviderResult {
  readonly candidates: readonly SearchCandidate[];
  readonly nextCursor: string | null;
}

export interface SearchProvider {
  search(input: {
    readonly query: SearchQuery;
    readonly principal: SearchPrincipal;
  }): Promise<SearchProviderResult>;
}

export interface SearchAuthorizationDecision {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly allowed: boolean;
}

export interface SearchAuthorizationService {
  authorizeBatch(input: {
    readonly principal: SearchPrincipal;
    readonly candidates: readonly SearchCandidate[];
  }): Promise<readonly SearchAuthorizationDecision[]>;
}

export interface SearchResult {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly category: string;
  readonly title: string;
  readonly snippet?: string;
  readonly score?: number;
  readonly actionTarget?: string;
  readonly sourceUpdatedAt?: string;
  readonly officiality?: string;
}

export interface SearchResultHydrator {
  hydrateBatch(input: {
    readonly principal: SearchPrincipal;
    readonly candidates: readonly SearchCandidate[];
  }): Promise<readonly SearchResult[]>;
}

export interface SearchResponse {
  readonly results: readonly SearchResult[];
  readonly nextCursor: string | null;
}
