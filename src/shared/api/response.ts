import type { ValidationIssue } from "../validation";

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly issues?: readonly ValidationIssue[];
  };
  readonly requestId: string;
}

export interface ApiPaginationMeta {
  readonly nextCursor: string | null;
  readonly limit: number;
  readonly hasMore: boolean;
}

export interface ApiConcurrencyMeta {
  readonly version?: number;
  readonly etag?: string;
}

export interface ApiResponseMeta {
  readonly pagination?: ApiPaginationMeta;
  readonly concurrency?: ApiConcurrencyMeta;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface ApiSuccessEnvelope<T, M extends ApiResponseMeta = ApiResponseMeta> {
  readonly data: T;
  readonly requestId: string;
  readonly meta?: M;
}

export type ApiDataDecoder<T> = (value: unknown) => T | null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const isRequestId = (value: unknown): value is string => isBoundedString(value, 128);
const isCode = (value: unknown): value is string =>
  isBoundedString(value, 64) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);

const decodeValidationIssue = (value: unknown): ValidationIssue | null => {
  if (!isRecord(value) || !isCode(value.code) || !isBoundedString(value.message, 500)) return null;
  if (value.path !== undefined && !isBoundedString(value.path, 500)) return null;
  return {
    code: value.code,
    message: value.message,
    ...(value.path !== undefined ? { path: value.path } : {}),
  };
};

const decodePagination = (value: unknown): ApiPaginationMeta | null => {
  if (!isRecord(value)) return null;
  if (value.nextCursor !== null && !isBoundedString(value.nextCursor, 4096)) return null;
  if (!Number.isSafeInteger(value.limit) || Number(value.limit) <= 0) return null;
  if (typeof value.hasMore !== "boolean") return null;
  return {
    nextCursor: value.nextCursor as string | null,
    limit: Number(value.limit),
    hasMore: value.hasMore,
  };
};

const decodeConcurrency = (value: unknown): ApiConcurrencyMeta | null => {
  if (!isRecord(value)) return null;
  const version = value.version;
  const etag = value.etag;
  if (version === undefined && etag === undefined) return null;
  if (version !== undefined && (!Number.isSafeInteger(version) || Number(version) < 0)) return null;
  if (etag !== undefined && !isBoundedString(etag, 512)) return null;
  return {
    ...(version !== undefined ? { version: Number(version) } : {}),
    ...(etag !== undefined ? { etag } : {}),
  };
};

export const decodeApiResponseMeta = (value: unknown): ApiResponseMeta | null => {
  if (!isRecord(value)) return null;
  const allowed = new Set(["pagination", "concurrency", "extensions"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;

  const pagination = value.pagination === undefined ? undefined : decodePagination(value.pagination);
  if (value.pagination !== undefined && pagination === null) return null;
  const concurrency = value.concurrency === undefined ? undefined : decodeConcurrency(value.concurrency);
  if (value.concurrency !== undefined && concurrency === null) return null;
  if (value.extensions !== undefined && !isRecord(value.extensions)) return null;

  return {
    ...(pagination ? { pagination } : {}),
    ...(concurrency ? { concurrency } : {}),
    ...(value.extensions !== undefined ? { extensions: Object.freeze({ ...value.extensions }) } : {}),
  };
};

export const decodeApiErrorEnvelope = (value: unknown): ApiErrorEnvelope | null => {
  if (!isRecord(value) || !isRequestId(value.requestId) || !isRecord(value.error)) return null;
  if (!isCode(value.error.code) || !isBoundedString(value.error.message, 500)) return null;

  let issues: readonly ValidationIssue[] | undefined;
  if (value.error.issues !== undefined) {
    if (!Array.isArray(value.error.issues) || value.error.issues.length > 100) return null;
    const decoded = value.error.issues.map(decodeValidationIssue);
    if (decoded.some((issue) => issue === null)) return null;
    issues = decoded as ValidationIssue[];
  }

  return {
    error: {
      code: value.error.code,
      message: value.error.message,
      ...(issues ? { issues } : {}),
    },
    requestId: value.requestId,
  };
};

export const decodeApiSuccessEnvelope = <T>(
  value: unknown,
  decodeData: ApiDataDecoder<T>,
): ApiSuccessEnvelope<T> | null => {
  if (!isRecord(value) || !isRequestId(value.requestId) || !("data" in value)) return null;
  const data = decodeData(value.data);
  if (data === null) return null;

  const meta = value.meta === undefined ? undefined : decodeApiResponseMeta(value.meta);
  if (value.meta !== undefined && meta === null) return null;

  return {
    data,
    requestId: value.requestId,
    ...(meta ? { meta } : {}),
  };
};

export const createApiSuccessEnvelope = <T, M extends ApiResponseMeta = ApiResponseMeta>(
  data: T,
  requestId: string,
  meta?: M,
): ApiSuccessEnvelope<T, M> => {
  if (!isRequestId(requestId)) throw new TypeError("requestId must be a non-empty string up to 128 characters");
  if (meta !== undefined && decodeApiResponseMeta(meta) === null) throw new TypeError("meta does not satisfy the shared API response contract");
  return Object.freeze({ data, requestId, ...(meta ? { meta } : {}) });
};
