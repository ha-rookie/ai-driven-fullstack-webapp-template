export interface SearchIndexDocument {
  readonly environment: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly category: string;
  readonly title: string;
  readonly text?: string;
  readonly keywords?: readonly string[];
  readonly sourceVersion: string;
  readonly sourceUpdatedAt: string;
  readonly indexedAt: string;
  readonly tombstonedAt?: string;
}

export interface SearchIndexWriter {
  upsert(document: SearchIndexDocument): Promise<void>;
  tombstone(input: {
    readonly environment: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly sourceVersion: string;
    readonly sourceUpdatedAt: string;
    readonly indexedAt: string;
  }): Promise<void>;
}

export interface SearchIndexReader {
  get(input: {
    readonly environment: string;
    readonly resourceType: string;
    readonly resourceId: string;
  }): Promise<SearchIndexDocument | null>;
}
