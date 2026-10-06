import type {
  SearchCandidate,
  SearchCategoryFailure,
  SearchPrincipal,
  SearchProvider,
  SearchProviderResult,
  SearchQuery,
} from "./types";

type CategoryProviderRegistry = Readonly<Record<string, SearchProvider>>;

interface FanoutCursor {
  readonly cursors: Readonly<Record<string, string>>;
  readonly done: readonly string[];
}

const encodeCursor = (value: FanoutCursor): string =>
  btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const decodeCursor = (value: string | undefined): FanoutCursor => {
  if (!value) return { cursors: {}, done: [] };
  try {
    const decoded = atob(
      value
        .replaceAll("-", "+")
        .replaceAll("_", "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "="),
    );
    const parsed = JSON.parse(decoded) as { cursors?: unknown; done?: unknown };
    if (!parsed.cursors || typeof parsed.cursors !== "object" || Array.isArray(parsed.cursors)) throw new Error();
    if (!Array.isArray(parsed.done) || parsed.done.some((category) => typeof category !== "string")) throw new Error();

    const cursors: Record<string, string> = {};
    for (const [key, cursor] of Object.entries(parsed.cursors)) {
      if (typeof cursor !== "string" || !cursor) throw new Error();
      cursors[key] = cursor;
    }
    return { cursors, done: parsed.done as string[] };
  } catch {
    throw new Error("invalid_fanout_cursor");
  }
};

type SettledCategory =
  | { readonly category: string; readonly result: SearchProviderResult }
  | { readonly category: string; readonly failure: SearchCategoryFailure };

export class CategoryFanoutSearchProvider implements SearchProvider {
  constructor(private readonly providers: CategoryProviderRegistry) {}

  async search(input: {
    readonly query: SearchQuery;
    readonly principal: SearchPrincipal;
  }): Promise<SearchProviderResult> {
    const categories = input.query.categories ?? Object.keys(this.providers);
    const state = decodeCursor(input.query.cursor);
    const activeCategories = categories.filter((category) => !state.done.includes(category));

    const settled: SettledCategory[] = await Promise.all(
      activeCategories.map(async (category): Promise<SettledCategory> => {
        const provider = this.providers[category];
        if (!provider) {
          return { category, failure: { category, code: "provider_unavailable" } };
        }
        try {
          const result = await provider.search({
            principal: input.principal,
            query: {
              ...input.query,
              categories: [category],
              cursor: state.cursors[category],
            },
          });
          return { category, result };
        } catch {
          return { category, failure: { category, code: "provider_error" } };
        }
      }),
    );

    const candidates: SearchCandidate[] = [];
    const failures: SearchCategoryFailure[] = [];
    const next: Record<string, string> = {};
    const done = new Set(state.done);

    for (const item of settled) {
      if ("failure" in item) {
        failures.push(item.failure);
        continue;
      }
      candidates.push(...item.result.candidates);
      if (item.result.nextCursor) next[item.category] = item.result.nextCursor;
      else done.add(item.category);
    }

    return {
      candidates: candidates.slice(0, input.query.limit ?? 20),
      nextCursor: Object.keys(next).length
        ? encodeCursor({ cursors: next, done: [...done] })
        : null,
      ...(failures.length ? { categoryFailures: failures } : {}),
    };
  }
}
