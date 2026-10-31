import { isRuntimeEnvironment, type RuntimeEnvironment } from "../shared/runtime/environment";
import {
  validateUserPreferencePatch,
  type ThemePreference,
  type UserPreferencePolicy,
  type UserPreferenceRecord,
  type UserPreferenceValues,
} from "../shared/user-preferences";
import {
  UserPreferenceConflictError,
  type UserPreferencesStore,
} from "../shared/in-memory-user-preferences-store";

interface PreferenceRow {
  user_id: string;
  environment: RuntimeEnvironment;
  version: number;
  locale: string | null;
  timezone: string | null;
  theme: ThemePreference | null;
  updated_at: string;
}

/** Single D1 statement per mutation. The WHERE version check is the write gate. */
export class D1UserPreferencesStore implements UserPreferencesStore {
  constructor(private readonly db: D1Database) {}

  async get(userId: string, environment: RuntimeEnvironment): Promise<UserPreferenceRecord | null> {
    if (!userId.trim() || !isRuntimeEnvironment(environment)) throw new TypeError("Invalid preference identity");
    const row = await this.db.prepare(
      "SELECT user_id, environment, version, locale, timezone, theme, updated_at " +
      "FROM user_preferences WHERE environment = ? AND user_id = ?",
    ).bind(environment, userId).first<PreferenceRow>();
    if (!row) return null;
    return {
      userId: row.user_id, environment: row.environment, schemaVersion: 1,
      version: row.version, locale: row.locale, timezone: row.timezone,
      theme: row.theme, updatedAt: row.updated_at,
    };
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
    const patch = validateUserPreferencePatch(input.patch, policy);
    const now = new Date().toISOString();
    let result: D1Result;
    if (expectedVersion === 0) {
      // On an existing row, DO NOTHING rather than update without a version.
      result = await this.db.prepare(
        "INSERT INTO user_preferences (environment,user_id,version,locale,timezone,theme,updated_at) " +
        "VALUES (?,?,1,?,?,?,?) ON CONFLICT(environment,user_id) DO NOTHING",
      ).bind(environment, userId, patch.locale ?? null, patch.timezone ?? null, patch.theme ?? null, now).run();
    } else {
      // Conditional UPDATE prevents concurrent stale writes. No read-modify-write race.
      result = await this.db.prepare(
        "UPDATE user_preferences SET " +
        "locale = CASE WHEN ? = 1 THEN ? ELSE locale END, " +
        "timezone = CASE WHEN ? = 1 THEN ? ELSE timezone END, " +
        "theme = CASE WHEN ? = 1 THEN ? ELSE theme END, " +
        "version = version + 1, updated_at = ? " +
        "WHERE environment = ? AND user_id = ? AND version = ?",
      ).bind(
        Object.hasOwn(patch, "locale") ? 1 : 0, patch.locale ?? null,
        Object.hasOwn(patch, "timezone") ? 1 : 0, patch.timezone ?? null,
        Object.hasOwn(patch, "theme") ? 1 : 0, patch.theme ?? null,
        now, environment, userId, expectedVersion,
      ).run();
    }
    if (result.meta.changes !== 1) {
      const current = await this.get(userId, environment);
      throw new UserPreferenceConflictError(current ? "version_conflict" : "not_found");
    }
    const stored = await this.get(userId, environment);
    if (!stored) throw new Error("Preference write verification failed");
    return stored;
  }
}
