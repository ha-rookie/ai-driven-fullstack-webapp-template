import {
  decodeApiErrorEnvelope,
  decodeApiSuccessEnvelope,
  type ApiDataDecoder,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
} from "../../shared/api";

export type ApiClientErrorKind = "http" | "protocol" | "network" | "timeout" | "aborted";

export class ApiClientError extends Error {
  readonly kind: ApiClientErrorKind;
  readonly status?: number;
  readonly requestId?: string;
  readonly apiError?: ApiErrorEnvelope;

  constructor(
    kind: ApiClientErrorKind,
    message: string,
    options: { status?: number; requestId?: string; apiError?: ApiErrorEnvelope } = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.kind = kind;
    this.status = options.status;
    this.requestId = options.requestId;
    this.apiError = options.apiError;
  }
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  readonly fetch?: FetchLike;
  readonly defaultTimeoutMs?: number;
  readonly maxJsonCharacters?: number;
  readonly getCsrfToken?: () => string | undefined;
}

export interface ApiRequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: HeadersInit;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface ApiNoContentResult {
  readonly requestId?: string;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_JSON_CHARACTERS = 1_048_576;

const positiveInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
};

const normalizePath = (path: string) => {
  if (!path.startsWith("/") || path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new TypeError("API client accepts same-origin absolute paths beginning with a single slash only");
  }
  return path;
};

const isJsonContentType = (value: string | null) => {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
};

const readRequestId = (response: Response) => {
  const value = response.headers.get("x-request-id")?.trim();
  return value ? value.slice(0, 128) : undefined;
};

export class ApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly defaultTimeoutMs: number;
  private readonly maxJsonCharacters: number;
  private readonly getCsrfToken?: () => string | undefined;

  constructor(options: ApiClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.defaultTimeoutMs = positiveInteger(options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS, "defaultTimeoutMs");
    this.maxJsonCharacters = positiveInteger(options.maxJsonCharacters ?? DEFAULT_MAX_JSON_CHARACTERS, "maxJsonCharacters");
    this.getCsrfToken = options.getCsrfToken;
  }

  async request<T>(
    path: string,
    decodeData: ApiDataDecoder<T>,
    options: ApiRequestOptions = {},
  ): Promise<ApiSuccessEnvelope<T>> {
    const response = await this.execute(path, options);
    if (response.status === 204) {
      throw new ApiClientError("protocol", "Expected JSON response but received no content", {
        status: response.status,
        requestId: readRequestId(response),
      });
    }
    const payload = await this.readJson(response);
    const decoded = decodeApiSuccessEnvelope(payload, decodeData);
    if (!decoded) {
      throw new ApiClientError("protocol", "Response did not satisfy the shared API schema", {
        status: response.status,
        requestId: readRequestId(response),
      });
    }
    return decoded;
  }

  async requestNoContent(path: string, options: ApiRequestOptions = {}): Promise<ApiNoContentResult> {
    const response = await this.execute(path, options);
    if (response.status !== 204) {
      throw new ApiClientError("protocol", "Expected a no-content response", {
        status: response.status,
        requestId: readRequestId(response),
      });
    }
    return { requestId: readRequestId(response) };
  }

  private async execute(path: string, options: ApiRequestOptions): Promise<Response> {
    const target = normalizePath(path);
    const method = (options.method ?? "GET").toUpperCase();
    if ((method === "GET" || method === "HEAD") && options.body !== undefined) {
      throw new TypeError(`${method} requests cannot include a JSON body`);
    }

    const headers = new Headers(options.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json");
    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
    }
    if (!SAFE_METHODS.has(method)) {
      const token = this.getCsrfToken?.();
      if (token && !headers.has("x-csrf-token")) headers.set("x-csrf-token", token);
    }

    const timeoutMs = positiveInteger(options.timeoutMs ?? this.defaultTimeoutMs, "timeoutMs");
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(target, {
        method,
        headers,
        body,
        credentials: "same-origin",
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw new ApiClientError("timeout", "Request timed out");
      if (options.signal?.aborted) throw new ApiClientError("aborted", "Request was aborted");
      throw new ApiClientError("network", "Network request failed");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }

    if (!response.ok) await this.throwHttpError(response);
    return response;
  }

  private async throwHttpError(response: Response): Promise<never> {
    const headerRequestId = readRequestId(response);
    let envelope: ApiErrorEnvelope | null = null;
    if (isJsonContentType(response.headers.get("content-type"))) {
      try {
        envelope = decodeApiErrorEnvelope(await this.readJson(response, true));
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.kind !== "protocol") throw error;
      }
    }
    throw new ApiClientError("http", envelope?.error.message ?? "Request failed", {
      status: response.status,
      requestId: envelope?.requestId ?? headerRequestId,
      ...(envelope ? { apiError: envelope } : {}),
    });
  }

  private async readJson(response: Response, allowErrorStatus = false): Promise<unknown> {
    if (!allowErrorStatus && !response.ok) throw new TypeError("readJson requires a successful response");
    if (!isJsonContentType(response.headers.get("content-type"))) {
      throw new ApiClientError("protocol", "Expected a JSON response", {
        status: response.status,
        requestId: readRequestId(response),
      });
    }
    const text = await response.text();
    if (text.length === 0 || text.length > this.maxJsonCharacters) {
      throw new ApiClientError("protocol", "JSON response size is invalid", {
        status: response.status,
        requestId: readRequestId(response),
      });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ApiClientError("protocol", "Response contained invalid JSON", {
        status: response.status,
        requestId: readRequestId(response),
      });
    }
  }
}
