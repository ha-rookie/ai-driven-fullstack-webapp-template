import {
  InMemorySearchCursorCodec,
  InMemorySearchProvider,
  SearchApplicationService,
  type SearchResult,
} from "../../worker/search";
import { listWorkhubApps } from "./app-catalog";
import { listWorkhubReferenceDocuments } from "./documents";
import { listWorkhubReferencePeople } from "./people";

/** Catalog indices are derived from the *currently authorized* Reference sources. */
export const WORKHUB_SEARCH_CATEGORIES = ["all", "requests", "apps", "documents", "people"] as const;
export type WorkhubUnifiedCategory = typeof WORKHUB_SEARCH_CATEGORIES[number];
export const isWorkhubUnifiedCategory = (value: string): value is WorkhubUnifiedCategory =>
  (WORKHUB_SEARCH_CATEGORIES as readonly string[]).includes(value);

interface CatalogEntry {
  readonly searchText: string;
  readonly result: SearchResult;
  readonly keywords: readonly string[];
}

const catalogForRole = (role: string): readonly CatalogEntry[] => {
  const apps: CatalogEntry[] = listWorkhubApps(role).flatMap(app =>
    app.availability === "available" && app.launchTarget
      ? [{
        searchText: app.description,
        keywords: [app.category],
        result: {
          resourceType: "workhub_app", resourceId: app.key, category: "apps",
          title: app.displayName, snippet: app.description,
          actionTarget: app.launchTarget, officiality: "app",
        },
      }]
      : []);
  const documents: CatalogEntry[] = listWorkhubApps(role).some(app => app.key === "knowledge" && app.availability === "available")
    ? listWorkhubReferenceDocuments(role).map(doc => ({
      searchText: doc.summary,
      keywords: [doc.category, doc.ownerLabel],
      result: {
        resourceType: "workhub_document", resourceId: doc.id, category: "documents",
        title: doc.title,
        snippet: (doc.state === "superseded" ? "旧版・利用注意｜" :
          doc.state === "stale" ? "要再確認｜" : "現行｜") + doc.summary
          + (doc.replacementTitle ? ` 現行文書：${doc.replacementTitle}` : ""),
        actionTarget: `/#workhub-document-${doc.id}`,
        officiality: doc.category === "公式" ? "official" : doc.category === "手順" ? "procedure" : "faq",
        sourceUpdatedAt: `${doc.reviewedAt}T00:00:00.000Z`,
      },
    }))
    : [];
  const people: CatalogEntry[] = listWorkhubApps(role).some(app => app.key === "directory" && app.availability === "available")
    ? listWorkhubReferencePeople().map((person, index) => ({
      searchText: `${person.roleLabel} ${person.organizationLabel}`,
      keywords: ["組織", "社員"],
      result: {
        resourceType: "workhub_person", resourceId: `reference-person-${index + 1}`,
        category: "people", title: person.displayName,
        snippet: `${person.roleLabel}｜${person.organizationLabel}`,
        actionTarget: `/#workhub-person-reference-person-${index + 1}`,
        officiality: "reference",
      },
    }))
    : [];
  return [...apps, ...documents, ...people];
};

/**
 * Uses #305 SearchApplicationService's normalization, candidate auth and
 * authorized hydration, rather than inventing a separate ad hoc text search.
 * Index is never an authorization source; caller must supply a server-owned role.
 */
export const searchWorkhubReferenceCatalog = async (
  role: string,
  principalId: string,
  environment: string,
  text: string,
  category: WorkhubUnifiedCategory,
): Promise<readonly SearchResult[]> => {
  const entries = catalogForRole(role);
  const byKey = new Map(entries.map(entry =>
    [`${entry.result.resourceType}: ${entry.result.resourceId}`, entry.result]));
  const service = new SearchApplicationService(
    new InMemorySearchProvider(entries.map(entry => ({
      resourceType: entry.result.resourceType,
      resourceId: entry.result.resourceId,
      category: entry.result.category,
      title: entry.result.title,
      text: entry.searchText,
      keywords: entry.keywords,
    }))),
    {
      async authorizeBatch({ candidates }) {
        return candidates.map(candidate => ({
          resourceType: candidate.resourceType, resourceId: candidate.resourceId,
          allowed: byKey.has(`${candidate.resourceType}: ${candidate.resourceId}`),
        }));
      },
    },
    {
      async hydrateBatch({ candidates }) {
        return candidates.flatMap(candidate => {
          const source = byKey.get(`${candidate.resourceType}: ${candidate.resourceId}`);
          return source ? [source] : [];
        });
      },
    },
    new InMemorySearchCursorCodec(),
  );
  const response = await service.search({ principalId, environment }, {
    text,
    categories: category === "all" ? ["apps", "documents", "people"] :
      category === "requests" ? ["requests"] : [category],
    limit: 100,
  });
  return response.results;
};

const AUTHORITY_RANK: Readonly<Record<string, number>> = {
  official: 500, procedure: 400, faq: 300, app: 250, reference: 200,
  business_record: 190,
};

/** Rank only results *already* authorized/hydrated by the relevant service. */
export const rankWorkhubUnifiedResults = (
  results: readonly SearchResult[],
  query: string,
): readonly SearchResult[] => {
  const term = query.trim().toLocaleLowerCase("ja-JP");
  const score = (item: SearchResult): number => {
    let value = AUTHORITY_RANK[item.officiality ?? ""] ?? 100;
    if (item.title.toLocaleLowerCase("ja-JP") === term) value += 40;
    if (item.title.toLocaleLowerCase("ja-JP").includes(term)) value += 10;
    if (item.snippet?.startsWith("旧版・")) value -= 150;
    if (item.snippet?.startsWith("要再確認｜")) value -= 65;
    return value;
  };
  return [...results].sort((a, b) =>
    score(b) - score(a) || a.title.localeCompare(b.title, "ja-JP"));
};
