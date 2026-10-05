import type { SearchIndexDocument, SearchIndexReader, SearchIndexWriter } from "./index-document";
import type { SearchCandidate, SearchPrincipal, SearchProvider, SearchProviderResult, SearchQuery } from "./types";

interface SearchIndexRow {
  environment: string;
  resource_type: string;
  resource_id: string;
  category: string;
  title: string;
  search_text: string;
  keywords_json: string;
  source_version: string;
  source_updated_at: string;
  indexed_at: string;
  tombstoned_at: string | null;
}

const mapRow = (row: SearchIndexRow): SearchIndexDocument => ({
  environment: row.environment,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  category: row.category,
  title: row.title,
  text: row.search_text || undefined,
  keywords: JSON.parse(row.keywords_json) as readonly string[],
  sourceVersion: row.source_version,
  sourceUpdatedAt: row.source_updated_at,
  indexedAt: row.indexed_at,
  tombstonedAt: row.tombstoned_at ?? undefined,
});

const normalizeTerms = (value: string): readonly string[] =>
  value.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean).slice(0, 8);

const escapeLike = (value: string): string => value.replace(/[!%_]/gu, (match) => `!${match}`);

const parseProviderCursor = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  const match = /^d1:(\d+)$/u.exec(cursor);
  if (!match) return 0;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
};

const searchBlob = (document: SearchIndexDocument): string =>
  [document.title, document.text ?? "", ...(document.keywords ?? [])].join(" ").trim();

export class D1SearchIndexStore implements SearchIndexWriter, SearchIndexReader {
  constructor(private readonly db: D1Database) {}

  async upsert(document: SearchIndexDocument): Promise<void> {
    await this.db.prepare(`
      INSERT INTO search_index_documents (
        environment, resource_type, resource_id, category, title, search_text,
        keywords_json, source_version, source_updated_at, indexed_at, tombstoned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(environment, resource_type, resource_id) DO UPDATE SET
        category = excluded.category,
        title = excluded.title,
        search_text = excluded.search_text,
        keywords_json = excluded.keywords_json,
        source_version = excluded.source_version,
        source_updated_at = excluded.source_updated_at,
        indexed_at = excluded.indexed_at,
        tombstoned_at = NULL
      WHERE excluded.source_updated_at > search_index_documents.source_updated_at
         OR (
           excluded.source_updated_at = search_index_documents.source_updated_at
           AND excluded.source_version >= search_index_documents.source_version
         )
    `).bind(
      document.environment,
      document.resourceType,
      document.resourceId,
      document.category,
      document.title,
      searchBlob(document),
      JSON.stringify(document.keywords ?? []),
      document.sourceVersion,
      document.sourceUpdatedAt,
      document.indexedAt,
    ).run();
  }

  async tombstone(input: {
    readonly environment: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly sourceVersion: string;
    readonly sourceUpdatedAt: string;
    readonly indexedAt: string;
  }): Promise<void> {
    await this.db.prepare(`
      INSERT INTO search_index_documents (
        environment, resource_type, resource_id, category, title, search_text,
        keywords_json, source_version, source_updated_at, indexed_at, tombstoned_at
      ) VALUES (?, ?, ?, '', '', '', '[]', ?, ?, ?, ?)
      ON CONFLICT(environment, resource_type, resource_id) DO UPDATE SET
        source_version = excluded.source_version,
        source_updated_at = excluded.source_updated_at,
        indexed_at = excluded.indexed_at,
        tombstoned_at = excluded.tombstoned_at
      WHERE excluded.source_updated_at > search_index_documents.source_updated_at
         OR (
           excluded.source_updated_at = search_index_documents.source_updated_at
           AND excluded.source_version >= search_index_documents.source_version
         )
    `).bind(
      input.environment,
      input.resourceType,
      input.resourceId,
      input.sourceVersion,
      input.sourceUpdatedAt,
      input.indexedAt,
      input.indexedAt,
    ).run();
  }

  async get(input: {
    readonly environment: string;
    readonly resourceType: string;
    readonly resourceId: string;
  }): Promise<SearchIndexDocument | null> {
    const row = await this.db.prepare(`
      SELECT environment, resource_type, resource_id, category, title, search_text,
             keywords_json, source_version, source_updated_at, indexed_at, tombstoned_at
      FROM search_index_documents
      WHERE environment = ? AND resource_type = ? AND resource_id = ?
      LIMIT 1
    `).bind(input.environment, input.resourceType, input.resourceId).first<SearchIndexRow>();
    return row ? mapRow(row) : null;
  }
}

export class D1SearchProvider implements SearchProvider {
  constructor(private readonly db: D1Database) {}

  async search(input: { readonly query: SearchQuery; readonly principal: SearchPrincipal }): Promise<SearchProviderResult> {
    const terms = normalizeTerms(input.query.text);
    const limit = Math.min(Math.max(input.query.limit ?? 20, 1), 100);
    const offset = parseProviderCursor(input.query.cursor);
    const categories = [...(input.query.categories ?? [])];

    const clauses = ["environment = ?", "tombstoned_at IS NULL"];
    const bindings: unknown[] = [input.principal.environment];

    for (const term of terms) {
      clauses.push("LOWER(search_text) LIKE ? ESCAPE '!'");
      bindings.push(`%${escapeLike(term)}%`);
    }

    if (categories.length > 0) {
      clauses.push(`category IN (${categories.map(() => "?").join(", ")})`);
      bindings.push(...categories);
    }

    const result = await this.db.prepare(`
      SELECT resource_type, resource_id, category
      FROM search_index_documents
      WHERE ${clauses.join(" AND ")}
      ORDER BY source_updated_at DESC, resource_type ASC, resource_id ASC
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit + 1, offset).all<{
      resource_type: string;
      resource_id: string;
      category: string;
    }>();

    const rows = result.results ?? [];
    const visible = rows.slice(0, limit);
    const candidates: SearchCandidate[] = visible.map((row) => ({
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      category: row.category,
    }));
    const nextCursor = rows.length > limit ? `d1:${offset + limit}` : null;
    return { candidates, nextCursor };
  }
}
