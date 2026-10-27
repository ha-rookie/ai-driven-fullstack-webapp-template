import { isRuntimeEnvironment, type RuntimeEnvironment } from "./runtime/environment";
import {
  validateUserPreferencePatch,
  type UserPreferencePolicy,
  type UserPreferenceRecord,
  type UserPreferenceValues,
} from "./user-preferences";

export class UserPreferenceConflictError extends Error {
  constructor(readonly reason: "not_found" | "version_conflict") {
    super(`Preference update rejected: ${reason}`);
    this.name = "UserPreferenceConflictError";
  }
}

export interface UserPreferencesStore {
  get(userId: string, environment: RuntimeEnvironment): Promise<UserPreferenceRecord | null>;
  update(input: {
    readonly userId: string;
    readonly environment: RuntimeEnvironment;
    readonly expectedVersion: number;
    readonly patch: UserPreferenceValues;
  }, policy: UserPreferencePolicy): Promise<UserPreferenceRecord>;
}

const key = (userId: string, environment: RuntimeEnvironment): string =>
  JSON.stringify([environment, userId]);

/**
 * A replaceable in-memory adapter for unit tests / examples, NOT a durable account store.
 * Real authenticated API integration requires a separately reviewed server-side adapter.
 */
export class InMemoryUserPreferencesStore implements UserPreferencesStore {
  private readonly records = new Map<string, UserPreferenceRecord>();

  async get(userId: string, environment: RuntimeEnvironment): Promise<UserPreferenceRecord | null> {
    if (!userId.trim() || !isRuntimeEnvironment(environment)) throw new TypeError("Invalid preference identity");
    const record = this.records.get(key(userId, environment));
    return record ? { ...record } : null;
  }

  async update(input: {
    readonly userId: string;
    readonly environment: RuntimeEnvironment;
    readonly expectedVersion: number;
    readonly patch: UserPreferenceValues;
  }, policy: UserPreferencePolicy): Promise<UserPreferenceRecord> {
    const { userId, environment, expectedVersion } = input;
    if (!userId.trim() || !isRuntimeEnvironment(environment)) throw new TypeError("Invalid preference identity");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new TypeError("expectedVersion must be a non-negative safe integer");
    }
    // Validate before any mutation; neither unknown keys nor security data may be persisted.
    const patch = validateUserPreferencePatch(input.patch, policy);
    const storageKey = key(userId, environment);
    const current = this.records.get(storageKey);
    if (!current && expectedVersion !== 0) throw new UserPreferenceConflictError("not_found");
    if (current && current.version !== expectedVersion) {
      throw new UserPreferenceConflictError("version_conflict");
    }
    const record: UserPreferenceRecord = {
      userId,
      environment,
      schemaVersion: 1,
      locale: patch.locale === undefined ? current?.locale ?? null : patch.locale,
      timezone: patch.timezone === undefined ? current?.timezone ?? null : patch.timezone,
      theme: patch.theme === undefined ? current?.theme ?? null : patch.theme,
      version: (current?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(storageKey, record);
    return { ...record };
  }
}
