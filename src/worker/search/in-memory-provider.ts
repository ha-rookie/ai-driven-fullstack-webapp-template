import type { SearchCandidate, SearchProvider, SearchProviderResult, SearchQuery } from "./types";

export interface InMemorySearchDocument {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly category: string;
  readonly title: string;
  readonly text?: string;
  readonly keywords?: readonly string[];
}

const matches = (document: InMemorySearchDocument, query: SearchQuery): boolean => {
  const needle = query.text.toLocaleLowerCase();
  const haystack = [document.title, document.text ?? "", ...(document.keywords ?? [])]
    .join("\n")
    .toLocaleLowerCase();
  if (!haystack.includes(needle)) return false;
  return !query.categories || query.categories.includes(document.category);
};

export class InMemorySearchProvider implements SearchProvider {
  constructor(private readonly documents: readonly InMemorySearchDocument[]) {}

  async search(input: { readonly query: SearchQuery }): Promise<SearchProviderResult> {
    const limit = input.query.limit ?? 20;
    const candidates: SearchCandidate[] = this.documents
      .filter((document) => matches(document, input.query))
      .slice(0, limit)
      .map((document) => ({
        resourceType: document.resourceType,
        resourceId: document.resourceId,
        category: document.category,
      }));

    return { candidates, nextCursor: null };
  }
}
