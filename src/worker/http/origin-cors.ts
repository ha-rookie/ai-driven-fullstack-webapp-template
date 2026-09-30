export const DEFAULT_CORS_ALLOWED_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export const DEFAULT_CORS_ALLOWED_HEADERS = [
  "content-type",
  "if-match",
  "x-csrf-token",
  "x-request-id",
] as const;

export const DEFAULT_CORS_MAX_AGE_SECONDS = 600;

export class CorsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorsConfigurationError";
  }
}

export interface CorsPolicy {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly allowedMethods: ReadonlySet<string>;
  readonly allowedHeaders: ReadonlySet<string>;
  readonly maxAgeSeconds: number;
}

export interface CreateCorsPolicyOptions {
  readonly allowedOrigins?: string | null;
  readonly allowedMethods?: readonly string[];
  readonly allowedHeaders?: readonly string[];
  readonly maxAgeSeconds?: number;
}

export type CorsRejectReason =
  | "invalid_origin"
  | "origin_not_allowed"
  | "method_not_allowed"
  | "header_not_allowed";

export type CorsDecision =
  | {
      readonly kind: "allow";
      readonly mode: "non-cors";
    }
  | {
      readonly kind: "allow";
      readonly mode: "same-origin";
      readonly origin: string;
    }
  | {
      readonly kind: "allow";
      readonly mode: "cross-origin";
      readonly origin: string;
    }
  | {
      readonly kind: "preflight";
      readonly origin: string;
      readonly requestedMethod: string;
      readonly requestedHeaders: readonly string[];
    }
  | {
      readonly kind: "reject";
      readonly reason: CorsRejectReason;
    };

const canonicalConfiguredOrigin = (value: string): string => {
  if (value === "*" || value === "null") {
    throw new CorsConfigurationError(
      "CORS allowed origins must not contain wildcard or null origins",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CorsConfigurationError("CORS allowed origin must be an absolute URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CorsConfigurationError(
      "CORS allowed origin must use http or https",
    );
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value
  ) {
    throw new CorsConfigurationError(
      "CORS allowed origin must be a canonical origin without path, credentials, query, or fragment",
    );
  }

  return url.origin;
};

const normalizeMethod = (value: string) => value.trim().toUpperCase();
const normalizeHeader = (value: string) => value.trim().toLowerCase();

export const createCorsPolicy = (
  options: CreateCorsPolicyOptions = {},
): CorsPolicy => {
  const allowedOrigins = new Set<string>();
  const rawOrigins = options.allowedOrigins?.trim();

  if (rawOrigins) {
    for (const rawEntry of rawOrigins.split(",")) {
      const entry = rawEntry.trim();
      if (!entry) {
        throw new CorsConfigurationError(
          "CORS allowed origins must not contain empty entries",
        );
      }
      allowedOrigins.add(canonicalConfiguredOrigin(entry));
    }
  }

  const allowedMethods = new Set(
    (options.allowedMethods ?? DEFAULT_CORS_ALLOWED_METHODS).map(normalizeMethod),
  );
  const allowedHeaders = new Set(
    (options.allowedHeaders ?? DEFAULT_CORS_ALLOWED_HEADERS).map(normalizeHeader),
  );
  const maxAgeSeconds =
    options.maxAgeSeconds ?? DEFAULT_CORS_MAX_AGE_SECONDS;

  if (
    allowedMethods.size === 0 ||
    [...allowedMethods].some((method) => !method)
  ) {
    throw new CorsConfigurationError("CORS allowed methods must not be empty");
  }
  if ([...allowedHeaders].some((header) => !header)) {
    throw new CorsConfigurationError("CORS allowed headers must not be empty");
  }
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new CorsConfigurationError(
      "CORS max age must be a non-negative integer",
    );
  }

  return {
    allowedOrigins,
    allowedMethods,
    allowedHeaders,
    maxAgeSeconds,
  };
};

const parseRequestOrigin = (value: string): string | null => {
  if (value === "null" || value === "*") return null;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin !== value
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

const requestedHeaders = (request: Request): readonly string[] => {
  const value = request.headers.get("access-control-request-headers");
  if (!value) return [];

  return [...new Set(value.split(",").map(normalizeHeader).filter(Boolean))];
};

export const evaluateCorsRequest = (
  request: Request,
  policy: CorsPolicy,
): CorsDecision => {
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return { kind: "allow", mode: "non-cors" };
  }

  const origin = parseRequestOrigin(originHeader);
  if (!origin) {
    return { kind: "reject", reason: "invalid_origin" };
  }

  const targetOrigin = new URL(request.url).origin;
  if (origin === targetOrigin) {
    return { kind: "allow", mode: "same-origin", origin };
  }

  if (!policy.allowedOrigins.has(origin)) {
    return { kind: "reject", reason: "origin_not_allowed" };
  }

  const requestedMethod = request.headers.get("access-control-request-method");
  if (request.method.toUpperCase() === "OPTIONS" && requestedMethod) {
    const method = normalizeMethod(requestedMethod);
    if (!policy.allowedMethods.has(method)) {
      return { kind: "reject", reason: "method_not_allowed" };
    }

    const headers = requestedHeaders(request);
    if (headers.some((header) => !policy.allowedHeaders.has(header))) {
      return { kind: "reject", reason: "header_not_allowed" };
    }

    return {
      kind: "preflight",
      origin,
      requestedMethod: method,
      requestedHeaders: headers,
    };
  }

  return { kind: "allow", mode: "cross-origin", origin };
};

const appendVary = (headers: Headers, values: readonly string[]) => {
  const existing = (headers.get("vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set(existing.map((value) => value.toLowerCase()));

  for (const value of values) {
    if (!seen.has(value.toLowerCase())) {
      existing.push(value);
      seen.add(value.toLowerCase());
    }
  }

  if (existing.length > 0) {
    headers.set("vary", existing.join(", "));
  }
};

export const applyCorsResponseHeaders = (
  response: Response,
  decision: CorsDecision,
): Response => {
  if (decision.kind !== "allow" || decision.mode !== "cross-origin") {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", decision.origin);
  headers.set("access-control-allow-credentials", "true");
  appendVary(headers, ["Origin"]);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const buildCorsPreflightResponse = (
  decision: Extract<CorsDecision, { readonly kind: "preflight" }>,
  policy: CorsPolicy,
): Response => {
  const headers = new Headers({
    "access-control-allow-origin": decision.origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": [...policy.allowedMethods].join(", "),
    "access-control-max-age": String(policy.maxAgeSeconds),
  });

  if (decision.requestedHeaders.length > 0) {
    headers.set(
      "access-control-allow-headers",
      decision.requestedHeaders.join(", "),
    );
  }

  appendVary(headers, [
    "Origin",
    "Access-Control-Request-Method",
    "Access-Control-Request-Headers",
  ]);

  return new Response(null, { status: 204, headers });
};
