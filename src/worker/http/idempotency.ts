import {
  completeIdempotencyRecord,
  createIdempotencyRecord,
  failIdempotencyRecord,
  type CreateIdempotencyRecordResult,
  type IdempotencyContext,
  type TransitionIdempotencyRecordResult,
} from "../../infrastructure/d1-idempotency-store";
import { systemClock, type Clock } from "../../shared/runtime";
import type { AuditEvent } from "../audit";
import { apiErrorResponse } from "./api-error";

export const IDEMPOTENCY_MAX_KEY_LENGTH = 128;
export const IDEMPOTENCY_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
export const IDEMPOTENCY_DEFAULT_TTL_SECONDS = 24 * 60 * 60;

const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]+$/;

type RequestAuditFields = Omit<AuditEvent, "requestId" | "method" | "path">;

export interface IdempotencyPolicy {
  readonly ttlSeconds?: number;
}

export interface IdempotencyGuardInput {
  readonly request: Request;
  readonly actorId: string;
  readonly scopeId: string;
  readonly action: string;
  readonly policy?: IdempotencyPolicy;
}

export interface IdempotencyExecutionContext extends IdempotencyContext {
  readonly fingerprint: string;
}

export type IdempotencyRejectReason =
  | "missing_key"
  | "invalid_key"
  | "fingerprint_mismatch"
  | "in_progress"
  | "completed"
  | "failed"
  | "expired";

export type IdempotencyProceedDecision = {
  readonly kind: "proceed";
  readonly execution: IdempotencyExecutionContext;
};

export type IdempotencyRejectDecision = {
  readonly kind: "reject";
  readonly reason: IdempotencyRejectReason;
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly replayable: false;
  readonly retryAfterSeconds?: number;
};

export type IdempotencyDecision =
  | IdempotencyProceedDecision
  | IdempotencyRejectDecision;

export interface IdempotencyHttpStore {
  create(
    input: IdempotencyContext & {
      fingerprint: string;
      createdAt: string;
      expiresAt: string;
    },
  ): Promise<CreateIdempotencyRecordResult>;
  complete(
    input: IdempotencyContext & { fingerprint: string; changedAt: string },
  ): Promise<TransitionIdempotencyRecordResult>;
  fail(
    input: IdempotencyContext & { fingerprint: string; changedAt: string },
  ): Promise<TransitionIdempotencyRecordResult>;
}

export const createD1IdempotencyHttpStore = (
  db: D1Database,
): IdempotencyHttpStore => ({
  create: (input) => createIdempotencyRecord(db, input),
  complete: (input) => completeIdempotencyRecord(db, input),
  fail: (input) => failIdempotencyRecord(db, input),
});

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const concatenate = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left, 0);
  combined.set(right, left.byteLength);
  return combined;
};

/**
 * Fingerprints the HTTP mutation without persisting raw request data.
 * Call this before consuming the original request body, or pass an untouched clone.
 */
export const fingerprintIdempotentRequest = async (
  request: Request,
): Promise<string> => {
  const url = new URL(request.url);
  const contentType = request.headers.get("content-type")?.trim().toLowerCase() ?? "";
  const body = new Uint8Array(await request.clone().arrayBuffer());
  const prefix = new TextEncoder().encode(
    [
      request.method.toUpperCase(),
      `${url.pathname}${url.search}`,
      contentType,
      String(body.byteLength),
      "",
    ].join("\n"),
  );
  return sha256Hex(concatenate(prefix, body));
};

const validateKey = (request: Request): IdempotencyRejectDecision | string => {
  const raw = request.headers.get("idempotency-key");
  if (raw === null || raw.trim() === "") {
    return {
      kind: "reject",
      reason: "missing_key",
      status: 400,
      code: "idempotency_key_required",
      message: "Idempotency-Key header is required",
      replayable: false,
    };
  }

  const key = raw.trim();
  if (
    key.length > IDEMPOTENCY_MAX_KEY_LENGTH ||
    !SAFE_IDEMPOTENCY_KEY.test(key)
  ) {
    return {
      kind: "reject",
      reason: "invalid_key",
      status: 400,
      code: "invalid_idempotency_key",
      message: `Idempotency-Key must be 1-${IDEMPOTENCY_MAX_KEY_LENGTH} safe ASCII characters`,
      replayable: false,
    };
  }
  return key;
};

const resolveTtlSeconds = (policy?: IdempotencyPolicy): number => {
  const ttlSeconds = policy?.ttlSeconds ?? IDEMPOTENCY_DEFAULT_TTL_SECONDS;
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > IDEMPOTENCY_MAX_TTL_SECONDS
  ) {
    throw new TypeError(
      `Idempotency ttlSeconds must be an integer between 1 and ${IDEMPOTENCY_MAX_TTL_SECONDS}`,
    );
  }
  return ttlSeconds;
};

const duplicateDecision = (
  result: Extract<CreateIdempotencyRecordResult, { kind: "existing" }>,
  fingerprint: string,
  nowMs: number,
): IdempotencyRejectDecision => {
  const { record } = result;
  if (record.fingerprint !== fingerprint) {
    return {
      kind: "reject",
      reason: "fingerprint_mismatch",
      status: 409,
      code: "idempotency_key_reused",
      message: "Idempotency-Key was already used for a different request",
      replayable: false,
    };
  }

  const expiresAtMs = Date.parse(record.expiresAt);
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    return {
      kind: "reject",
      reason: "expired",
      status: 409,
      code: "idempotency_key_expired",
      message: "Idempotency-Key record has expired; use a new key",
      replayable: false,
    };
  }

  if (record.state === "in_progress") {
    return {
      kind: "reject",
      reason: "in_progress",
      status: 409,
      code: "idempotency_in_progress",
      message: "An equivalent request is already in progress",
      replayable: false,
      retryAfterSeconds: 1,
    };
  }
  if (record.state === "completed") {
    return {
      kind: "reject",
      reason: "completed",
      status: 409,
      code: "idempotency_completed_no_replay",
      message: "This request already completed and response replay is not enabled",
      replayable: false,
    };
  }
  return {
    kind: "reject",
    reason: "failed",
    status: 409,
    code: "idempotency_failed_key_consumed",
    message: "This Idempotency-Key is already consumed; use a new key",
    replayable: false,
  };
};

export class IdempotencyHttpGuard {
  constructor(
    private readonly store: IdempotencyHttpStore,
    private readonly clock: Clock = systemClock,
  ) {}

  async begin(input: IdempotencyGuardInput): Promise<IdempotencyDecision> {
    const keyResult = validateKey(input.request);
    if (typeof keyResult !== "string") return keyResult;

    const ttlSeconds = resolveTtlSeconds(input.policy);
    const now = this.clock.now();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) {
      throw new TypeError("Idempotency clock returned invalid time");
    }

    const fingerprint = await fingerprintIdempotentRequest(input.request);
    const context: IdempotencyExecutionContext = {
      key: keyResult,
      actorId: input.actorId,
      scopeId: input.scopeId,
      action: input.action,
      fingerprint,
    };
    const createdAt = now.toISOString();
    const expiresAt = new Date(nowMs + ttlSeconds * 1_000).toISOString();
    const result = await this.store.create({
      ...context,
      createdAt,
      expiresAt,
    });

    if (result.kind === "created") {
      return { kind: "proceed", execution: context };
    }
    return duplicateDecision(result, fingerprint, nowMs);
  }

  complete(
    execution: IdempotencyExecutionContext,
  ): Promise<TransitionIdempotencyRecordResult> {
    return this.store.complete({
      ...execution,
      changedAt: this.clock.now().toISOString(),
    });
  }

  fail(
    execution: IdempotencyExecutionContext,
  ): Promise<TransitionIdempotencyRecordResult> {
    return this.store.fail({
      ...execution,
      changedAt: this.clock.now().toISOString(),
    });
  }
}

export const idempotencyRejectionResponse = (
  decision: IdempotencyRejectDecision,
  requestId: string,
): Response => {
  const response = apiErrorResponse(
    {
      status: decision.status,
      code: decision.code,
      message: decision.message,
      extra: { replayable: decision.replayable },
    },
    requestId,
  );
  if (!decision.retryAfterSeconds) return response;

  const headers = new Headers(response.headers);
  headers.set("retry-after", String(decision.retryAfterSeconds));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/** Safe Audit fields. Idempotency-Key and fingerprint are deliberately excluded. */
export const idempotencyAuditFields = (
  input: Pick<IdempotencyGuardInput, "actorId" | "scopeId" | "action">,
  decision: IdempotencyDecision,
): RequestAuditFields => ({
  category: "system",
  action: "idempotency_guard",
  outcome: decision.kind === "proceed" ? "success" : "failure",
  actorId: input.actorId,
  scopeId: input.scopeId,
  resourceType: "http_mutation",
  resourceId: input.action,
  ...(decision.kind === "reject" ? { reason: decision.reason } : {}),
});
