import {
  cryptoIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
} from "../runtime";

const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const JOB_TYPE_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const SCHEDULE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SENSITIVE_PAYLOAD_KEY_PATTERN = /(^|[_-])(authorization|cookie|credential|password|secret|session|token|signed[_-]?url)([_-]|$)/i;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_PAYLOAD_DEPTH = 24;
const MAX_PROGRESS_CODE_LENGTH = 128;
const MAX_FAILURE_CODE_LENGTH = 128;

export type AsyncJobState =
  | "pending"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "dead_letter";

export interface AsyncJobEnvelope<TPayload = unknown> {
  readonly version: 1;
  readonly jobId: string;
  readonly type: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly correlationId?: string;
  readonly payloadFingerprint: string;
  readonly payload: TPayload;
}

export interface AsyncJobPayloadPolicy {
  readonly maxPayloadBytes?: number;
}

export interface CreateAsyncJobEnvelopeInput<TPayload> {
  readonly type: string;
  readonly payload: TPayload;
  readonly jobId?: string;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
  readonly payloadPolicy?: AsyncJobPayloadPolicy;
}

export interface ScheduledJobIdentity {
  readonly jobId: string;
  readonly idempotencyKey: string;
  readonly scheduledFor: string;
}

export interface AsyncJobProgress {
  readonly percent: number;
  readonly code?: string;
}

export interface AsyncJobRecord {
  readonly jobId: string;
  readonly type: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly state: AsyncJobState;
  readonly attempt: number;
  readonly requestedAt: string;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: string;
  readonly nextAttemptAt?: string;
  readonly progress?: AsyncJobProgress;
  readonly failureCode?: string;
}

export type AsyncJobClaimResult =
  | { readonly kind: "acquired"; readonly record: AsyncJobRecord }
  | { readonly kind: "completed"; readonly record: AsyncJobRecord }
  | { readonly kind: "terminal"; readonly record: AsyncJobRecord }
  | { readonly kind: "leased"; readonly record: AsyncJobRecord; readonly retryAfterMs: number }
  | { readonly kind: "not_due"; readonly record: AsyncJobRecord; readonly retryAfterMs: number }
  | { readonly kind: "conflict"; readonly record: AsyncJobRecord };

export interface AsyncJobClaimInput {
  readonly envelope: AsyncJobEnvelope;
  readonly leaseToken: string;
  readonly now: Date;
  readonly leaseMs: number;
}

export interface AsyncJobStateStore {
  claim(input: AsyncJobClaimInput): Promise<AsyncJobClaimResult>;
  reportProgress(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly progress: AsyncJobProgress;
  }): Promise<boolean>;
  complete(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<boolean>;
  retry(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly nextAttemptAt: Date;
    readonly failureCode: string;
  }): Promise<boolean>;
  fail(input: {
    readonly idempotencyKey: string;
    readonly leaseToken: string;
    readonly now: Date;
    readonly state: "failed" | "dead_letter";
    readonly failureCode: string;
  }): Promise<boolean>;
  getByIdempotencyKey(idempotencyKey: string): Promise<AsyncJobRecord | null>;
}

export interface AsyncJobPublishOptions {
  readonly delayMs?: number;
}

export interface AsyncJobPublisher {
  publish<TPayload>(
    envelope: AsyncJobEnvelope<TPayload>,
    options?: AsyncJobPublishOptions,
  ): Promise<void>;
}

export interface AsyncJobRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier?: number;
}

export interface AsyncJobFailureClassification {
  readonly retryable: boolean;
  readonly code: string;
}

export class AsyncJobExecutionError extends Error {
  constructor(
    readonly classification: AsyncJobFailureClassification,
    message = "Async job execution failed",
  ) {
    super(message);
    this.name = "AsyncJobExecutionError";
  }
}

export interface AsyncJobHandlerContext {
  readonly attempt: number;
  reportProgress(progress: AsyncJobProgress): Promise<void>;
}

export type AsyncJobHandler<TPayload> = (
  payload: TPayload,
  context: AsyncJobHandlerContext,
) => Promise<void>;

export type AsyncJobExecutionResult =
  | { readonly kind: "completed"; readonly attempt: number }
  | { readonly kind: "duplicate_completed" }
  | { readonly kind: "terminal_duplicate"; readonly state: "failed" | "dead_letter" }
  | { readonly kind: "retry"; readonly attempt: number; readonly delayMs: number; readonly failureCode: string }
  | { readonly kind: "failed"; readonly attempt: number; readonly failureCode: string }
  | { readonly kind: "dead_letter"; readonly attempt: number; readonly failureCode: string }
  | { readonly kind: "busy"; readonly retryAfterMs: number }
  | { readonly kind: "not_due"; readonly retryAfterMs: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "lost_lease"; readonly retryAfterMs: number };

export interface ExecuteAsyncJobInput<TPayload> {
  readonly envelope: AsyncJobEnvelope<TPayload>;
  readonly store: AsyncJobStateStore;
  readonly handler: AsyncJobHandler<TPayload>;
  readonly retryPolicy: AsyncJobRetryPolicy;
  readonly leaseMs: number;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
  readonly classifyError?: (error: unknown) => AsyncJobFailureClassification;
  readonly payloadPolicy?: AsyncJobPayloadPolicy;
}

const assertPositiveSafeInteger = (
  value: number,
  name: string,
  maximum?: number,
): void => {
  if (!Number.isSafeInteger(value) || value <= 0 || (maximum !== undefined && value > maximum)) {
    throw new RangeError(
      maximum === undefined
        ? `${name} must be a positive safe integer`
        : `${name} must be between 1 and ${maximum}`,
    );
  }
};

const assertIsoTimestamp = (value: string, name: string): void => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${name} must be an ISO-8601 UTC timestamp`);
  }
};

const assertIdentifier = (value: string, name: string): void => {
  if (!JOB_ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a bounded opaque identifier`);
  }
};

const assertJobType = (value: string): void => {
  if (!JOB_TYPE_PATTERN.test(value)) {
    throw new TypeError("job type must use lower-case public tokens");
  }
};

const assertBoundedCode = (value: string, name: string, maximum: number): void => {
  if (
    value.length === 0
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${name} must be a bounded non-control string`);
  }
};

const normalizePayloadLimit = (policy?: AsyncJobPayloadPolicy): number => {
  const maxPayloadBytes = policy?.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  assertPositiveSafeInteger(maxPayloadBytes, "maxPayloadBytes", MAX_PAYLOAD_BYTES);
  return maxPayloadBytes;
};

const assertJsonPayloadValue = (
  value: unknown,
  path: string,
  depth: number,
): void => {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new TypeError("Async job payload nesting is too deep");
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite JSON numbers`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonPayloadValue(item, `${path}[${index}]`, depth + 1));
    return;
  }

  if (typeof value !== "object") {
    throw new TypeError(`${path} must contain only JSON values`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must use plain JSON objects`);
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_PAYLOAD_KEY_PATTERN.test(key)) {
      throw new TypeError(`Async job payload must not contain sensitive field '${key}'`);
    }
    assertJsonPayloadValue(nested, `${path}.${key}`, depth + 1);
  }
};

const canonicalizeJson = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalizeJson(nested)}`)
    .join(",")}}`;
};

const encodeHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

export const sha256AsyncJobPayload = async (canonicalPayload: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload));
  return encodeHex(digest);
};

export const validateAsyncJobPayload = (
  payload: unknown,
  policy?: AsyncJobPayloadPolicy,
): string => {
  assertJsonPayloadValue(payload, "payload", 0);
  const canonicalPayload = canonicalizeJson(payload);
  const byteLength = new TextEncoder().encode(canonicalPayload).byteLength;
  const maxPayloadBytes = normalizePayloadLimit(policy);
  if (byteLength > maxPayloadBytes) {
    throw new RangeError(`Async job payload exceeds ${maxPayloadBytes} bytes`);
  }
  return canonicalPayload;
};

export const createAsyncJobEnvelope = async <TPayload>(
  input: CreateAsyncJobEnvelopeInput<TPayload>,
): Promise<AsyncJobEnvelope<TPayload>> => {
  assertJobType(input.type);
  const idGenerator = input.idGenerator ?? cryptoIdGenerator;
  const clock = input.clock ?? systemClock;
  const jobId = input.jobId ?? idGenerator.generate();
  const idempotencyKey = input.idempotencyKey ?? jobId;
  assertIdentifier(jobId, "jobId");
  assertIdentifier(idempotencyKey, "idempotencyKey");
  if (input.correlationId !== undefined) assertIdentifier(input.correlationId, "correlationId");

  const requestedAt = clock.now().toISOString();
  assertIsoTimestamp(requestedAt, "requestedAt");
  const canonicalPayload = validateAsyncJobPayload(input.payload, input.payloadPolicy);
  const payloadFingerprint = await sha256AsyncJobPayload(canonicalPayload);

  return Object.freeze({
    version: 1 as const,
    jobId,
    type: input.type,
    idempotencyKey,
    requestedAt,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    payloadFingerprint,
    payload: input.payload,
  });
};

export const verifyAsyncJobEnvelope = async (
  envelope: AsyncJobEnvelope,
  policy?: AsyncJobPayloadPolicy,
): Promise<void> => {
  if (envelope.version !== 1) throw new TypeError("Unsupported async job envelope version");
  assertIdentifier(envelope.jobId, "jobId");
  assertJobType(envelope.type);
  assertIdentifier(envelope.idempotencyKey, "idempotencyKey");
  assertIsoTimestamp(envelope.requestedAt, "requestedAt");
  if (envelope.correlationId !== undefined) assertIdentifier(envelope.correlationId, "correlationId");
  if (!SHA256_PATTERN.test(envelope.payloadFingerprint)) {
    throw new TypeError("payloadFingerprint must be a SHA-256 hex digest");
  }

  const canonicalPayload = validateAsyncJobPayload(envelope.payload, policy);
  const actualFingerprint = await sha256AsyncJobPayload(canonicalPayload);
  if (actualFingerprint !== envelope.payloadFingerprint) {
    throw new TypeError("Async job payload fingerprint mismatch");
  }
};

export const createScheduledJobIdentity = (
  scheduleKey: string,
  scheduledFor: Date,
): ScheduledJobIdentity => {
  if (!SCHEDULE_KEY_PATTERN.test(scheduleKey)) {
    throw new TypeError("scheduleKey must be a bounded public identifier");
  }
  if (!Number.isFinite(scheduledFor.getTime())) {
    throw new TypeError("scheduledFor must be a valid date");
  }
  const scheduledForIso = scheduledFor.toISOString();
  const identity = `scheduled:${scheduleKey}:${scheduledForIso}`;
  assertIdentifier(identity, "scheduled job identity");
  return {
    jobId: identity,
    idempotencyKey: identity,
    scheduledFor: scheduledForIso,
  };
};

export const normalizeAsyncJobProgress = (progress: AsyncJobProgress): AsyncJobProgress => {
  if (!Number.isSafeInteger(progress.percent) || progress.percent < 0 || progress.percent > 100) {
    throw new RangeError("Async job progress percent must be an integer between 0 and 100");
  }
  if (progress.code !== undefined) {
    assertBoundedCode(progress.code, "progress.code", MAX_PROGRESS_CODE_LENGTH);
  }
  return Object.freeze({ ...progress });
};

export const validateAsyncJobRetryPolicy = (policy: AsyncJobRetryPolicy): void => {
  assertPositiveSafeInteger(policy.maxAttempts, "maxAttempts", 100);
  assertPositiveSafeInteger(policy.baseDelayMs, "baseDelayMs", 24 * 60 * 60 * 1000);
  assertPositiveSafeInteger(policy.maxDelayMs, "maxDelayMs", 7 * 24 * 60 * 60 * 1000);
  if (policy.maxDelayMs < policy.baseDelayMs) {
    throw new RangeError("maxDelayMs must be greater than or equal to baseDelayMs");
  }
  const multiplier = policy.multiplier ?? 2;
  if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10) {
    throw new RangeError("retry multiplier must be between 1 and 10");
  }
};

export const calculateAsyncJobRetryDelayMs = (
  failedAttempt: number,
  policy: AsyncJobRetryPolicy,
): number => {
  validateAsyncJobRetryPolicy(policy);
  assertPositiveSafeInteger(failedAttempt, "failedAttempt", policy.maxAttempts);
  const multiplier = policy.multiplier ?? 2;
  const raw = policy.baseDelayMs * multiplier ** (failedAttempt - 1);
  return Math.min(policy.maxDelayMs, Math.max(policy.baseDelayMs, Math.floor(raw)));
};

const defaultClassifyError = (error: unknown): AsyncJobFailureClassification => {
  if (error instanceof AsyncJobExecutionError) return error.classification;
  return { retryable: true, code: "unclassified_error" };
};

const normalizeFailureClassification = (
  classification: AsyncJobFailureClassification,
): AsyncJobFailureClassification => {
  assertBoundedCode(classification.code, "failure code", MAX_FAILURE_CODE_LENGTH);
  return Object.freeze({ ...classification });
};

const millisecondsUntil = (futureIso: string | undefined, now: Date): number => {
  if (futureIso === undefined) return 1000;
  return Math.max(1, new Date(futureIso).getTime() - now.getTime());
};

export const executeAsyncJob = async <TPayload>(
  input: ExecuteAsyncJobInput<TPayload>,
): Promise<AsyncJobExecutionResult> => {
  validateAsyncJobRetryPolicy(input.retryPolicy);
  assertPositiveSafeInteger(input.leaseMs, "leaseMs", 24 * 60 * 60 * 1000);
  await verifyAsyncJobEnvelope(input.envelope, input.payloadPolicy);

  const clock = input.clock ?? systemClock;
  const idGenerator = input.idGenerator ?? cryptoIdGenerator;
  const now = clock.now();
  const leaseToken = idGenerator.generate();
  assertIdentifier(leaseToken, "leaseToken");

  const claim = await input.store.claim({
    envelope: input.envelope,
    leaseToken,
    now,
    leaseMs: input.leaseMs,
  });

  if (claim.kind === "completed") return { kind: "duplicate_completed" };
  if (claim.kind === "terminal") {
    return { kind: "terminal_duplicate", state: claim.record.state as "failed" | "dead_letter" };
  }
  if (claim.kind === "leased") return { kind: "busy", retryAfterMs: claim.retryAfterMs };
  if (claim.kind === "not_due") return { kind: "not_due", retryAfterMs: claim.retryAfterMs };
  if (claim.kind === "conflict") return { kind: "conflict" };

  const attempt = claim.record.attempt;
  const reportProgress = async (progress: AsyncJobProgress): Promise<void> => {
    const normalized = normalizeAsyncJobProgress(progress);
    const updated = await input.store.reportProgress({
      idempotencyKey: input.envelope.idempotencyKey,
      leaseToken,
      now: clock.now(),
      progress: normalized,
    });
    if (!updated) {
      throw new AsyncJobExecutionError(
        { retryable: true, code: "job_lease_lost" },
        "Async job lease was lost while reporting progress",
      );
    }
  };

  try {
    await input.handler(input.envelope.payload, { attempt, reportProgress });
    const completed = await input.store.complete({
      idempotencyKey: input.envelope.idempotencyKey,
      leaseToken,
      now: clock.now(),
    });
    if (!completed) {
      return { kind: "lost_lease", retryAfterMs: input.leaseMs };
    }
    return { kind: "completed", attempt };
  } catch (error) {
    const classification = normalizeFailureClassification(
      (input.classifyError ?? defaultClassifyError)(error),
    );

    if (classification.retryable && attempt < input.retryPolicy.maxAttempts) {
      const delayMs = calculateAsyncJobRetryDelayMs(attempt, input.retryPolicy);
      const retryStored = await input.store.retry({
        idempotencyKey: input.envelope.idempotencyKey,
        leaseToken,
        now: clock.now(),
        nextAttemptAt: new Date(clock.now().getTime() + delayMs),
        failureCode: classification.code,
      });
      if (!retryStored) return { kind: "lost_lease", retryAfterMs: input.leaseMs };
      return {
        kind: "retry",
        attempt,
        delayMs,
        failureCode: classification.code,
      };
    }

    const terminalState: "failed" | "dead_letter" = classification.retryable
      ? "dead_letter"
      : "failed";
    const failed = await input.store.fail({
      idempotencyKey: input.envelope.idempotencyKey,
      leaseToken,
      now: clock.now(),
      state: terminalState,
      failureCode: classification.code,
    });
    if (!failed) return { kind: "lost_lease", retryAfterMs: input.leaseMs };

    return terminalState === "dead_letter"
      ? { kind: "dead_letter", attempt, failureCode: classification.code }
      : { kind: "failed", attempt, failureCode: classification.code };
  }
};

export const retryAfterFromRecord = (record: AsyncJobRecord, now: Date): number =>
  record.state === "running"
    ? millisecondsUntil(record.leaseExpiresAt, now)
    : millisecondsUntil(record.nextAttemptAt, now);
