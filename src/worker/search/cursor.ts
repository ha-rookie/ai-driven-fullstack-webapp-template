import type { SearchPrincipal, SearchQuery } from "./types";

export interface SearchCursorBinding {
  readonly principalId: string;
  readonly environment: string;
  readonly text: string;
  readonly categories: readonly string[];
  readonly locale: string | null;
}

export interface SearchCursorPayload {
  readonly providerCursor: string;
  readonly binding: SearchCursorBinding;
}

export interface SearchCursorCodec {
  encode(payload: SearchCursorPayload): Promise<string>;
  decode(cursor: string): Promise<SearchCursorPayload | null>;
}

const bindingFrom = (principal: SearchPrincipal, query: SearchQuery): SearchCursorBinding => ({
  principalId: principal.principalId,
  environment: principal.environment,
  text: query.text,
  categories: Object.freeze([...(query.categories ?? [])].sort()),
  locale: query.locale ?? null,
});

export const createSearchCursorBinding = bindingFrom;

export const sameSearchCursorBinding = (
  left: SearchCursorBinding,
  right: SearchCursorBinding,
): boolean =>
  left.principalId === right.principalId &&
  left.environment === right.environment &&
  left.text === right.text &&
  left.locale === right.locale &&
  left.categories.length === right.categories.length &&
  left.categories.every((category, index) => category === right.categories[index]);

export class InMemorySearchCursorCodec implements SearchCursorCodec {
  private readonly entries = new Map<string, SearchCursorPayload>();

  async encode(payload: SearchCursorPayload): Promise<string> {
    const cursor = crypto.randomUUID();
    this.entries.set(cursor, {
      providerCursor: payload.providerCursor,
      binding: {
        ...payload.binding,
        categories: Object.freeze([...payload.binding.categories]),
      },
    });
    return cursor;
  }

  async decode(cursor: string): Promise<SearchCursorPayload | null> {
    const entry = this.entries.get(cursor);
    if (!entry) return null;
    return {
      providerCursor: entry.providerCursor,
      binding: {
        ...entry.binding,
        categories: Object.freeze([...entry.binding.categories]),
      },
    };
  }
}
