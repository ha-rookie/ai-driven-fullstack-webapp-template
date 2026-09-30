import { systemClock, type Clock } from "../../shared/runtime";
import type { AuditEvent } from "../audit";
import { apiErrorResponse } from "./api-error";

export const RATE_LIMIT_KEY_VERSION = "v1";
export const RATE_LIMIT_MAX_ENDPOINT_ID_LENGTH = 64;
export const RATE_LIMIT_MAX_SUBJECT_ID_LENGTH = 128;
export const RATE_LIMIT_MAX_LIMIT = 1_000_000;
export const RATE_LIMIT_MAX_WINDOW_SECONDS = 86_400;

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;

export class RateLimitConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitConfigurationError";
  }
}

export class RateLimitStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitStoreError";
  }
}

export interface RateLimitPolicy {
  readonly endpointId: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export type RateLimitSubject =
  | { readonly kind: "actor"; readonly id: string }
  | { readonly kind: "ip"; readonly id: string };

export interface RateLimitCheckInput {
  readonly policy: RateLimitPolicy;
  readonly subject: RateLimitSubject;
}

export interface RateLimitStoreIncrement {
  /** Opaque versioned key. Implementations must increment this key atomically. */
  readonly key: string;
  readonly nowMs: number;
  readonly resetAtMs: number;
}

export interface RateLimitStore {
  increment(input: RateLimitStoreIncrement): Promise<number>;
}

interface RateLimitDecisionBase {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAtEpochSeconds: number;
}

export type RateLimitAllowDecision = RateLimitDecisionBase & {
  readonly kind: "allow";
};

export type RateLimitRejectDecision = RateLimitDecisionBase & {
  readonly kind: "reject";
  readonly retryAfterSeconds: number;
};

export type RateLimitDecision =
  | RateLimitAllowDecision
  | RateLimitRejectDecision;

type RequestAuditFields = Omit<AuditEvent, "requestId" | "method" | "path">;

const assertSafeIdentifier = (
  label: string,
  value: string,
  maxLength: number,
): void => {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    !SAFE_IDENTIFIER.test(value)
  ) {
    throw new RateLimitConfigurationError(
      `${label} must be a safe identifier of at most ${maxLength} characters`,
    );
  }
};

const validatePolicy = (policy: RateLimitPolicy): void => {
  assertSafeIdentifier(
    "Rate limit endpointId",
    policy.endpointId,
    RATE_LIMIT_MAX_ENDPOINT_ID_LENGTH,
  );
  if (
    !Number.isInteger(policy.limit) ||
    policy.limit < 1 ||
    policy.limit > RATE_LIMIT_MAX_LIMIT
  ) {
    throw new RateLimitConfigurationError(
      `Rate limit limit must be an integer between 1 and ${RATE_LIMIT_MAX_LIMIT}`,
    );
  }
  if (
    !Number.isInteger(policy.windowSeconds) ||
    policy.windowSeconds < 1 ||
    policy.windowSeconds > RATE_LIMIT_MAX_WINDOW_SECONDS
  ) {
    throw new RateLimitConfigurationError(
      `Rate limit windowSeconds must be an integer between 1 and ${RATE_LIMIT_MAX_WINDOW_SECONDS}`,
    );
  }
};

const validateSubject = (subject: RateLimitSubject): void => {
  assertSafeIdentifier(
    `Rate limit ${subject.kind} subject`,
    subject.id,
    RATE_LIMIT_MAX_SUBJECT_ID_LENGTH,
  );
};

const sha256Hex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const storageKey = async (
  input: RateLimitCheckInput,
  windowStartMs: number,
): Promise<string> => {
  // Subject identifiers (including IP addresses) are not persisted verbatim.
  const subjectHash = await sha256Hex(`${input.subject.kind}:${input.subject.id}`);
  return [
    "rate-limit",
    RATE_LIMIT_KEY_VERSION,
    input.policy.endpointId,
    input.subject.kind,
    subjectHash,
    String(windowStartMs),
  ].join(":");
};

/**
 * Generic fixed-window guard. A production project must inject a shared store
 * whose increment operation is atomic for a key.
 */
export class RateLimitGuard {
  constructor(
    private readonly store: RateLimitStore,
    private readonly clock: Clock = systemClock,
  ) {}

  async check(input: RateLimitCheckInput): Promise<RateLimitDecision> {
    validatePolicy(input.policy);
    validateSubject(input.subject);

    const nowMs = this.clock.now().getTime();
    if (!Number.isFinite(nowMs)) {
      throw new RateLimitConfigurationError("Rate limit clock returned invalid time");
    }

    const windowMs = input.policy.windowSeconds * 1_000;
    const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
    const resetAtMs = windowStartMs + windowMs;
    const key = await storageKey(input, windowStartMs);
    const count = await this.store.increment({ key, nowMs, resetAtMs });

    if (!Number.isInteger(count) || count < 1) {
      throw new RateLimitStoreError(
        "Rate limit store must return a positive integer count",
      );
    }

    const remaining = Math.max(0, input.policy.limit - count);
    const base: RateLimitDecisionBase = {
      limit: input.policy.limit,
      remaining,
      resetAtEpochSeconds: Math.floor(resetAtMs / 1_000),
    };

    if (count <= input.policy.limit) {
      return { kind: "allow", ...base };
    }

    return {
      kind: "reject",
      ...base,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1_000)),
    };
  }
}

interface LocalBucket {
  readonly count: number;
  readonly resetAtMs: number;
}

/**
 * LOCAL TEST/DEV ONLY. Worker isolate memory is not a distributed security
 * boundary and this store must not be wired as a production rate limiter.
 */
export class LocalRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, LocalBucket>();

  get size(): number {
    return this.buckets.size;
  }

  increment(input: RateLimitStoreIncrement): Promise<number> {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAtMs <= input.nowMs) {
        this.buckets.delete(key);
      }
    }

    const current = this.buckets.get(input.key);
    const count = current ? current.count + 1 : 1;
    this.buckets.set(input.key, { count, resetAtMs: input.resetAtMs });
    return Promise.resolve(count);
  }
}

export const rateLimitRejectionResponse = (
  decision: RateLimitRejectDecision,
  requestId: string,
): Response => {
  const response = apiErrorResponse(
    {
      status: 429,
      code: "rate_limited",
      message: "Too many requests",
    },
    requestId,
  );
  const headers = new Headers(response.headers);
  headers.set("retry-after", String(decision.retryAfterSeconds));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/** Safe fields for the existing Audit helper; never includes IP or storage key. */
export const rateLimitRejectionAuditFields = (
  input: RateLimitCheckInput,
): RequestAuditFields => ({
  category: "system",
  action: "rate_limit_guard",
  outcome: "failure",
  ...(input.subject.kind === "actor" ? { actorId: input.subject.id } : {}),
  resourceType: "http_endpoint",
  resourceId: input.policy.endpointId,
  reason:
    input.subject.kind === "actor"
      ? "actor_rate_limited"
      : "ip_rate_limited",
});
