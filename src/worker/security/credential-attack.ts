import { systemClock, type Clock, type RuntimeEnvironment } from "../../shared/runtime";
import { apiErrorResponse } from "../http/api-error";

export const CREDENTIAL_ATTACK_KEY_VERSION = "v1";
export const CREDENTIAL_ATTACK_MAX_ENDPOINT_ID_LENGTH = 64;
export const CREDENTIAL_ATTACK_MAX_SUBJECT_LENGTH = 512;
export const CREDENTIAL_ATTACK_MAX_THRESHOLD = 10_000;
export const CREDENTIAL_ATTACK_MAX_WINDOW_SECONDS = 86_400;
export const CREDENTIAL_ATTACK_MAX_LOCK_SECONDS = 86_400;

const SAFE_ENDPOINT_ID = /^[A-Za-z0-9._:-]+$/u;

export type CredentialAttackDimension = "identifier" | "network";

export interface CredentialAttackSubject {
  readonly dimension: CredentialAttackDimension;
  /** Raw value is accepted only long enough to hash it. Stores must never receive it. */
  readonly value: string;
}

export interface CredentialAttackPolicy {
  readonly endpointId: string;
  readonly failureThreshold: number;
  readonly windowSeconds: number;
  readonly lockSeconds: number;
}

export interface CredentialAttackStoreKey {
  readonly environment: RuntimeEnvironment;
  readonly endpointId: string;
  readonly dimension: CredentialAttackDimension;
  readonly subjectHash: string;
}

export interface CredentialAttackState {
  readonly failureCount: number;
  readonly windowStartedAt: string;
  readonly lockedUntil: string | null;
}

export interface CredentialAttackFailureWrite extends CredentialAttackStoreKey {
  readonly now: string;
  readonly windowCutoff: string;
  readonly failureThreshold: number;
  readonly newLockedUntil: string;
}

export interface CredentialAttackStore {
  get(key: CredentialAttackStoreKey): Promise<CredentialAttackState | null>;
  recordFailure(input: CredentialAttackFailureWrite): Promise<CredentialAttackState>;
  clear(key: CredentialAttackStoreKey): Promise<void>;
}

export type CredentialAttackDecision =
  | {
      readonly kind: "allow";
      readonly failureCount: number;
    }
  | {
      readonly kind: "reject";
      readonly failureCount: number;
      readonly retryAfterSeconds: number;
      readonly lockedUntil: string;
    };

export class CredentialAttackConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialAttackConfigurationError";
  }
}

export class CredentialAttackStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialAttackStoreError";
  }
}

interface CredentialAttackRow {
  readonly failure_count: number;
  readonly window_started_at: string;
  readonly locked_until: string | null;
}

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point !== undefined && (point < 32 || point === 127)) return true;
  }
  return false;
};

const assertPositiveInteger = (
  value: number,
  label: string,
  maximum: number,
): void => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new CredentialAttackConfigurationError(
      `${label} must be an integer between 1 and ${maximum}`,
    );
  }
};

const validatePolicy = (policy: CredentialAttackPolicy): void => {
  if (
    policy.endpointId.length === 0
    || policy.endpointId.length > CREDENTIAL_ATTACK_MAX_ENDPOINT_ID_LENGTH
    || !SAFE_ENDPOINT_ID.test(policy.endpointId)
  ) {
    throw new CredentialAttackConfigurationError("Credential endpointId is invalid");
  }
  assertPositiveInteger(
    policy.failureThreshold,
    "failureThreshold",
    CREDENTIAL_ATTACK_MAX_THRESHOLD,
  );
  assertPositiveInteger(
    policy.windowSeconds,
    "windowSeconds",
    CREDENTIAL_ATTACK_MAX_WINDOW_SECONDS,
  );
  assertPositiveInteger(
    policy.lockSeconds,
    "lockSeconds",
    CREDENTIAL_ATTACK_MAX_LOCK_SECONDS,
  );
};

const canonicalSubjectValue = (subject: CredentialAttackSubject): string => {
  const normalized = subject.value.normalize("NFKC").trim();
  if (
    normalized.length === 0
    || Array.from(normalized).length > CREDENTIAL_ATTACK_MAX_SUBJECT_LENGTH
    || containsControlCharacter(normalized)
  ) {
    throw new CredentialAttackConfigurationError("Credential attack subject is invalid");
  }
  return normalized;
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const createCredentialAttackStoreKey = async (
  environment: RuntimeEnvironment,
  policy: CredentialAttackPolicy,
  subject: CredentialAttackSubject,
): Promise<CredentialAttackStoreKey> => {
  validatePolicy(policy);
  const subjectValue = canonicalSubjectValue(subject);
  return {
    environment,
    endpointId: policy.endpointId,
    dimension: subject.dimension,
    subjectHash: await sha256Hex(
      `${CREDENTIAL_ATTACK_KEY_VERSION}:${subject.dimension}:${subjectValue}`,
    ),
  };
};

const parseState = (row: CredentialAttackRow | null): CredentialAttackState | null => {
  if (!row) return null;
  if (!Number.isSafeInteger(row.failure_count) || row.failure_count < 0) {
    throw new CredentialAttackStoreError("Credential attack store returned invalid failure count");
  }
  if (!Number.isFinite(new Date(row.window_started_at).getTime())) {
    throw new CredentialAttackStoreError("Credential attack store returned invalid window timestamp");
  }
  if (row.locked_until !== null && !Number.isFinite(new Date(row.locked_until).getTime())) {
    throw new CredentialAttackStoreError("Credential attack store returned invalid lock timestamp");
  }
  return {
    failureCount: row.failure_count,
    windowStartedAt: row.window_started_at,
    lockedUntil: row.locked_until,
  };
};

export interface D1CredentialAttackStoreOptions {
  readonly db: D1Database;
}

/** Durable shared state for Preview/Production. Raw identifiers and IPs never reach this store. */
export class D1CredentialAttackStore implements CredentialAttackStore {
  constructor(private readonly options: D1CredentialAttackStoreOptions) {}

  async get(key: CredentialAttackStoreKey): Promise<CredentialAttackState | null> {
    const row = await this.options.db.prepare(`
      SELECT failure_count, window_started_at, locked_until
      FROM credential_attack_states
      WHERE environment = ? AND endpoint_id = ? AND dimension = ? AND subject_hash = ?
    `).bind(
      key.environment,
      key.endpointId,
      key.dimension,
      key.subjectHash,
    ).first<CredentialAttackRow>();
    return parseState(row);
  }

  async recordFailure(input: CredentialAttackFailureWrite): Promise<CredentialAttackState> {
    const row = await this.options.db.prepare(`
      INSERT INTO credential_attack_states (
        environment, endpoint_id, dimension, subject_hash,
        failure_count, window_started_at, locked_until, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, NULL, ?)
      ON CONFLICT(environment, endpoint_id, dimension, subject_hash) DO UPDATE SET
        failure_count = CASE
          WHEN credential_attack_states.locked_until IS NOT NULL
            AND credential_attack_states.locked_until > ?
            THEN credential_attack_states.failure_count
          WHEN (credential_attack_states.locked_until IS NOT NULL
            AND credential_attack_states.locked_until <= ?)
            OR credential_attack_states.window_started_at <= ?
            THEN 1
          ELSE MIN(credential_attack_states.failure_count + 1, ?)
        END,
        window_started_at = CASE
          WHEN credential_attack_states.locked_until IS NOT NULL
            AND credential_attack_states.locked_until > ?
            THEN credential_attack_states.window_started_at
          WHEN (credential_attack_states.locked_until IS NOT NULL
            AND credential_attack_states.locked_until <= ?)
            OR credential_attack_states.window_started_at <= ?
            THEN ?
          ELSE credential_attack_states.window_started_at
        END,
        locked_until = CASE
          WHEN credential_attack_states.locked_until IS NOT NULL
            AND credential_attack_states.locked_until > ?
            THEN credential_attack_states.locked_until
          WHEN (
            CASE
              WHEN (credential_attack_states.locked_until IS NOT NULL
                AND credential_attack_states.locked_until <= ?)
                OR credential_attack_states.window_started_at <= ?
                THEN 1
              ELSE credential_attack_states.failure_count + 1
            END
          ) >= ? THEN ?
          ELSE NULL
        END,
        updated_at = ?
      RETURNING failure_count, window_started_at, locked_until
    `).bind(
      input.environment,
      input.endpointId,
      input.dimension,
      input.subjectHash,
      input.now,
      input.now,
      input.now,
      input.now,
      input.windowCutoff,
      input.failureThreshold,
      input.now,
      input.now,
      input.windowCutoff,
      input.now,
      input.now,
      input.now,
      input.windowCutoff,
      input.failureThreshold,
      input.newLockedUntil,
      input.now,
    ).first<CredentialAttackRow>();

    const state = parseState(row);
    if (!state) throw new CredentialAttackStoreError("Credential attack failure state was not returned");
    return state;
  }

  async clear(key: CredentialAttackStoreKey): Promise<void> {
    await this.options.db.prepare(`
      DELETE FROM credential_attack_states
      WHERE environment = ? AND endpoint_id = ? AND dimension = ? AND subject_hash = ?
    `).bind(
      key.environment,
      key.endpointId,
      key.dimension,
      key.subjectHash,
    ).run();
  }
}

/** LOCAL/TEST ONLY. Worker isolate memory must not be used as a Production security boundary. */
export class InMemoryCredentialAttackStore implements CredentialAttackStore {
  private readonly states = new Map<string, CredentialAttackState>();

  private key(input: CredentialAttackStoreKey): string {
    return `${input.environment}:${input.endpointId}:${input.dimension}:${input.subjectHash}`;
  }

  get(input: CredentialAttackStoreKey): Promise<CredentialAttackState | null> {
    return Promise.resolve(this.states.get(this.key(input)) ?? null);
  }

  recordFailure(input: CredentialAttackFailureWrite): Promise<CredentialAttackState> {
    const key = this.key(input);
    const current = this.states.get(key);
    const activeLock = current?.lockedUntil !== null
      && current?.lockedUntil !== undefined
      && current.lockedUntil > input.now;
    const restart = current === undefined
      || (current.lockedUntil !== null && current.lockedUntil <= input.now)
      || current.windowStartedAt <= input.windowCutoff;

    if (activeLock && current) return Promise.resolve(current);

    const failureCount = restart ? 1 : Math.min(current.failureCount + 1, input.failureThreshold);
    const state: CredentialAttackState = {
      failureCount,
      windowStartedAt: restart ? input.now : current.windowStartedAt,
      lockedUntil: failureCount >= input.failureThreshold ? input.newLockedUntil : null,
    };
    this.states.set(key, state);
    return Promise.resolve(state);
  }

  clear(input: CredentialAttackStoreKey): Promise<void> {
    this.states.delete(this.key(input));
    return Promise.resolve();
  }
}

export class CredentialAttackGuard {
  constructor(
    private readonly store: CredentialAttackStore,
    private readonly environment: RuntimeEnvironment,
    private readonly clock: Clock = systemClock,
  ) {}

  async check(
    policy: CredentialAttackPolicy,
    subject: CredentialAttackSubject,
  ): Promise<CredentialAttackDecision> {
    const key = await createCredentialAttackStoreKey(this.environment, policy, subject);
    return this.decisionFromState(await this.store.get(key), this.clock.now());
  }

  async recordFailure(
    policy: CredentialAttackPolicy,
    subject: CredentialAttackSubject,
  ): Promise<CredentialAttackDecision> {
    validatePolicy(policy);
    const now = this.clock.now();
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) {
      throw new CredentialAttackConfigurationError("Credential attack clock returned invalid time");
    }
    const key = await createCredentialAttackStoreKey(this.environment, policy, subject);
    const state = await this.store.recordFailure({
      ...key,
      now: now.toISOString(),
      windowCutoff: new Date(nowMs - policy.windowSeconds * 1_000).toISOString(),
      failureThreshold: policy.failureThreshold,
      newLockedUntil: new Date(nowMs + policy.lockSeconds * 1_000).toISOString(),
    });
    return this.decisionFromState(state, now);
  }

  async recordSuccess(
    policy: CredentialAttackPolicy,
    subject: CredentialAttackSubject,
  ): Promise<void> {
    const key = await createCredentialAttackStoreKey(this.environment, policy, subject);
    await this.store.clear(key);
  }

  private decisionFromState(
    state: CredentialAttackState | null,
    now: Date,
  ): CredentialAttackDecision {
    if (!state?.lockedUntil || state.lockedUntil <= now.toISOString()) {
      return { kind: "allow", failureCount: state?.failureCount ?? 0 };
    }
    return {
      kind: "reject",
      failureCount: state.failureCount,
      lockedUntil: state.lockedUntil,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((new Date(state.lockedUntil).getTime() - now.getTime()) / 1_000),
      ),
    };
  }
}

/** Generic throttle response. It never reveals whether the supplied account exists. */
export const credentialAttackRejectionResponse = (
  decision: Extract<CredentialAttackDecision, { kind: "reject" }>,
  requestId: string,
): Response => {
  const response = apiErrorResponse(
    {
      status: 429,
      code: "authentication_temporarily_limited",
      message: "Authentication is temporarily unavailable. Try again later.",
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
