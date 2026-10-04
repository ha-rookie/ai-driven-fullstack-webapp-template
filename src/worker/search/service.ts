import {
  createSearchCursorBinding,
  sameSearchCursorBinding,
  type SearchCursorCodec,
} from "./cursor";
import type {
  SearchAuthorizationDecision,
  SearchAuthorizationService,
  SearchCandidate,
  SearchPrincipal,
  SearchProvider,
  SearchQuery,
  SearchResponse,
  SearchResultHydrator,
} from "./types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 512;
const MAX_CATEGORY_COUNT = 20;
const CATEGORY_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export class SearchRequestError extends Error {
  constructor(readonly code: "invalid_query" | "invalid_limit" | "invalid_category" | "invalid_cursor") {
    super(code);
    this.name = "SearchRequestError";
  }
}

const hasForbiddenControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
};

const normalizeQuery = (query: SearchQuery): SearchQuery => {
  const text = query.text.trim();
  if (!text || text.length > MAX_QUERY_LENGTH || hasForbiddenControlCharacter(text)) {
    throw new SearchRequestError("invalid_query");
  }

  const limit = query.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new SearchRequestError("invalid_limit");
  }

  const categories = query.categories ? [...new Set(query.categories)] : undefined;
  if (categories && (categories.length > MAX_CATEGORY_COUNT || categories.some((category) => !CATEGORY_PATTERN.test(category)))) {
    throw new SearchRequestError("invalid_category");
  }

  if (query.cursor !== undefined && (!query.cursor || query.cursor.length > 2048)) {
    throw new SearchRequestError("invalid_cursor");
  }

  return Object.freeze({
    text,
    limit,
    ...(categories ? { categories: Object.freeze(categories) } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(query.locale ? { locale: query.locale } : {}),
  });
};

const decisionKey = (decision: SearchAuthorizationDecision): string =>
  `${decision.resourceType}\u0000${decision.resourceId}`;
const candidateKey = (candidate: SearchCandidate): string =>
  `${candidate.resourceType}\u0000${candidate.resourceId}`;

export class SearchApplicationService {
  constructor(
    private readonly provider: SearchProvider,
    private readonly authorization: SearchAuthorizationService,
    private readonly hydrator: SearchResultHydrator,
    private readonly cursorCodec: SearchCursorCodec,
  ) {}

  async search(principal: SearchPrincipal, query: SearchQuery): Promise<SearchResponse> {
    const normalized = normalizeQuery(query);
    const binding = createSearchCursorBinding(principal, normalized);
    let providerCursor: string | undefined;

    if (normalized.cursor) {
      const decoded = await this.cursorCodec.decode(normalized.cursor);
      if (!decoded || !sameSearchCursorBinding(decoded.binding, binding)) {
        throw new SearchRequestError("invalid_cursor");
      }
      providerCursor = decoded.providerCursor;
    }

    const providerQuery: SearchQuery = {
      ...normalized,
      ...(providerCursor ? { cursor: providerCursor } : { cursor: undefined }),
    };
    const providerResult = await this.provider.search({ query: providerQuery, principal });
    const nextCursor = providerResult.nextCursor
      ? await this.cursorCodec.encode({ providerCursor: providerResult.nextCursor, binding })
      : null;

    if (providerResult.candidates.length === 0) {
      return { results: [], nextCursor };
    }

    const decisions = await this.authorization.authorizeBatch({
      principal,
      candidates: providerResult.candidates,
    });
    const allowed = new Set(
      decisions.filter((decision) => decision.allowed).map(decisionKey),
    );
    const authorizedCandidates = providerResult.candidates.filter((candidate) => allowed.has(candidateKey(candidate)));

    if (authorizedCandidates.length === 0) {
      return { results: [], nextCursor };
    }

    const hydrated = await this.hydrator.hydrateBatch({
      principal,
      candidates: authorizedCandidates,
    });
    const authorizedKeys = new Set(authorizedCandidates.map(candidateKey));
    const safeResults = hydrated.filter((result) => authorizedKeys.has(`${result.resourceType}\u0000${result.resourceId}`));

    return {
      results: safeResults.slice(0, normalized.limit ?? DEFAULT_LIMIT),
      nextCursor,
    };
  }
}
