export interface WorkhubSearchApiItem {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly category: string;
  readonly title: string;
  readonly actionTarget?: string;
}

export interface WorkhubSearchApiResponse {
  readonly items: readonly WorkhubSearchApiItem[];
  readonly nextCursor: string | null;
}

export interface WorkhubSearchApiQuery {
  readonly text: string;
  readonly categories?: readonly string[];
  readonly cursor?: string;
  readonly limit?: number;
}
