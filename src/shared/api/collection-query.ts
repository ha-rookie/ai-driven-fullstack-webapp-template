import type { ValidationIssue } from "../validation";
import type { ApiPaginationMeta } from "./response";

export type CollectionSortDirection = "asc" | "desc";

export interface CollectionSort<TSortKey extends string> {
  readonly key: TSortKey;
  readonly direction: CollectionSortDirection;
}

export interface CollectionQueryContract<
  TSortKey extends string,
  TFilterKey extends string,
  TCursor,
> {
  readonly defaultLimit: number;
  readonly maxLimit: number;
  readonly allowedSortKeys: readonly TSortKey[];
  readonly defaultSort: CollectionSort<TSortKey>;
  readonly stableTieBreaker: CollectionSort<TSortKey>;
  readonly allowedFilterKeys: readonly TFilterKey[];
  readonly decodeCursor: (value: string) => TCursor | null;
  readonly maxCursorLength?: number;
  readonly validateFilter?: (
    key: TFilterKey,
    values: readonly string[],
  ) => readonly ValidationIssue[];
}

export interface ParsedCollectionQuery<
  TSortKey extends string,
  TFilterKey extends string,
  TCursor,
> {
  readonly cursor: TCursor | null;
  readonly limit: number;
  readonly sort: readonly CollectionSort<TSortKey>[];
  readonly filters: Readonly<Partial<Record<TFilterKey, readonly string[]>>>;
}

export type CollectionQueryParseResult<
  TSortKey extends string,
  TFilterKey extends string,
  TCursor,
> =
  | {
      readonly ok: true;
      readonly value: ParsedCollectionQuery<TSortKey, TFilterKey, TCursor>;
    }
  | {
      readonly ok: false;
      readonly issues: readonly ValidationIssue[];
    };

const DEFAULT_MAX_CURSOR_LENGTH = 4096;

const boundedPositiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

const issue = (code: string, path: string, message: string): ValidationIssue => ({
  code,
  path,
  message,
});

const readSingleton = (
  params: URLSearchParams,
  key: string,
  issues: ValidationIssue[],
): string | undefined => {
  const values = params.getAll(key);
  if (values.length === 0) return undefined;
  if (values.length > 1) {
    issues.push(issue(
      "collection_query.duplicate_parameter",
      key,
      `${key} must be provided at most once`,
    ));
    return undefined;
  }
  return values[0];
};

const validateContract = <TSortKey extends string, TFilterKey extends string, TCursor>(
  contract: CollectionQueryContract<TSortKey, TFilterKey, TCursor>,
): void => {
  if (!boundedPositiveInteger(contract.defaultLimit)) {
    throw new TypeError("defaultLimit must be a positive safe integer");
  }
  if (!boundedPositiveInteger(contract.maxLimit)) {
    throw new TypeError("maxLimit must be a positive safe integer");
  }
  if (contract.defaultLimit > contract.maxLimit) {
    throw new TypeError("defaultLimit must not exceed maxLimit");
  }
  if (!contract.allowedSortKeys.includes(contract.defaultSort.key)) {
    throw new TypeError("defaultSort.key must be included in allowedSortKeys");
  }
  if (!contract.allowedSortKeys.includes(contract.stableTieBreaker.key)) {
    throw new TypeError("stableTieBreaker.key must be included in allowedSortKeys");
  }
  if (new Set(contract.allowedSortKeys).size !== contract.allowedSortKeys.length) {
    throw new TypeError("allowedSortKeys must not contain duplicates");
  }
  if (new Set(contract.allowedFilterKeys).size !== contract.allowedFilterKeys.length) {
    throw new TypeError("allowedFilterKeys must not contain duplicates");
  }
  if (
    contract.maxCursorLength !== undefined
    && !boundedPositiveInteger(contract.maxCursorLength)
  ) {
    throw new TypeError("maxCursorLength must be a positive safe integer");
  }
};

export const parseCollectionQuery = <
  TSortKey extends string,
  TFilterKey extends string,
  TCursor,
>(
  params: URLSearchParams,
  contract: CollectionQueryContract<TSortKey, TFilterKey, TCursor>,
): CollectionQueryParseResult<TSortKey, TFilterKey, TCursor> => {
  validateContract(contract);
  const issues: ValidationIssue[] = [];

  const cursorValue = readSingleton(params, "cursor", issues);
  const limitValue = readSingleton(params, "limit", issues);
  const sortValue = readSingleton(params, "sort", issues);
  const directionValue = readSingleton(params, "direction", issues);

  let cursor: TCursor | null = null;
  if (cursorValue !== undefined) {
    const maxCursorLength = contract.maxCursorLength ?? DEFAULT_MAX_CURSOR_LENGTH;
    if (cursorValue.length === 0 || cursorValue.length > maxCursorLength) {
      issues.push(issue(
        "collection_query.invalid_cursor",
        "cursor",
        "cursor is empty or exceeds the allowed length",
      ));
    } else {
      try {
        cursor = contract.decodeCursor(cursorValue);
      } catch {
        cursor = null;
      }
      if (cursor === null) {
        issues.push(issue(
          "collection_query.invalid_cursor",
          "cursor",
          "cursor is invalid or cannot be verified",
        ));
      }
    }
  }

  let limit = contract.defaultLimit;
  if (limitValue !== undefined) {
    if (!/^\d+$/.test(limitValue)) {
      issues.push(issue(
        "collection_query.invalid_limit",
        "limit",
        "limit must be a positive integer",
      ));
    } else {
      const parsed = Number(limitValue);
      if (!boundedPositiveInteger(parsed) || parsed > contract.maxLimit) {
        issues.push(issue(
          "collection_query.invalid_limit",
          "limit",
          `limit must be between 1 and ${contract.maxLimit}`,
        ));
      } else {
        limit = parsed;
      }
    }
  }

  let requestedSort = contract.defaultSort;
  if (sortValue !== undefined) {
    if (!contract.allowedSortKeys.includes(sortValue as TSortKey)) {
      issues.push(issue(
        "collection_query.unknown_sort",
        "sort",
        "sort is not an allowed public sort key",
      ));
    } else {
      requestedSort = {
        key: sortValue as TSortKey,
        direction: requestedSort.direction,
      };
    }
  }

  if (directionValue !== undefined) {
    if (directionValue !== "asc" && directionValue !== "desc") {
      issues.push(issue(
        "collection_query.invalid_sort_direction",
        "direction",
        "direction must be asc or desc",
      ));
    } else {
      requestedSort = {
        key: requestedSort.key,
        direction: directionValue,
      };
    }
  }

  const filters: Partial<Record<TFilterKey, readonly string[]>> = {};
  for (const key of new Set(params.keys())) {
    if (!key.startsWith("filter.")) continue;
    const publicFilterKey = key.slice("filter.".length);
    if (publicFilterKey.length === 0 || !contract.allowedFilterKeys.includes(publicFilterKey as TFilterKey)) {
      issues.push(issue(
        "collection_query.unknown_filter",
        key,
        "filter is not an allowed public filter key",
      ));
      continue;
    }

    const values = params.getAll(key);
    if (values.some((value) => value.length === 0)) {
      issues.push(issue(
        "collection_query.invalid_filter",
        key,
        "filter values must not be empty",
      ));
      continue;
    }

    const filterKey = publicFilterKey as TFilterKey;
    const projectIssues = contract.validateFilter?.(filterKey, values) ?? [];
    issues.push(...projectIssues);
    filters[filterKey] = Object.freeze([...values]);
  }

  if (issues.length > 0) {
    return { ok: false, issues: Object.freeze(issues) };
  }

  const sort = requestedSort.key === contract.stableTieBreaker.key
    ? [requestedSort]
    : [requestedSort, contract.stableTieBreaker];

  return {
    ok: true,
    value: {
      cursor,
      limit,
      sort: Object.freeze(sort),
      filters: Object.freeze({ ...filters }),
    },
  };
};

export const createCollectionPaginationMeta = (
  limit: number,
  nextCursor: string | null,
): ApiPaginationMeta => {
  if (!boundedPositiveInteger(limit)) {
    throw new TypeError("limit must be a positive safe integer");
  }
  if (
    nextCursor !== null
    && (nextCursor.length === 0 || nextCursor.length > DEFAULT_MAX_CURSOR_LENGTH)
  ) {
    throw new TypeError("nextCursor must be null or a non-empty string up to 4096 characters");
  }
  return Object.freeze({
    nextCursor,
    limit,
    hasMore: nextCursor !== null,
  });
};
