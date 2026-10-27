import type { RuntimeEnvironment } from "./runtime/environment";

export type ThemePreference = "light" | "dark" | "system";
export type PreferenceField = "locale" | "timezone" | "theme";
export type PreferenceSource = "forced" | "user" | "device" | "project" | "system";

export interface UserPreferenceValues {
  readonly locale?: string | null;
  readonly timezone?: string | null;
  readonly theme?: ThemePreference | null;
}

export interface PreferenceValuePolicy<T extends string> {
  readonly allowed: readonly T[];
  readonly forced?: T;
  readonly projectDefault?: T;
  readonly systemDefault: T;
}

export interface UserPreferencePolicy {
  readonly locale: PreferenceValuePolicy<string>;
  readonly timezone: PreferenceValuePolicy<string>;
  readonly theme: PreferenceValuePolicy<ThemePreference>;
}

export interface PreferenceDeviceSignals {
  readonly locale?: string;
  readonly timezone?: string;
  readonly prefersDark?: boolean;
}

export interface ResolvedUserPreferences {
  readonly locale: string;
  readonly timezone: string;
  readonly theme: ThemePreference;
  readonly colorScheme: "light" | "dark";
  readonly source: Readonly<Record<PreferenceField, PreferenceSource>>;
}

export interface UserPreferenceRecord {
  readonly userId: string;
  readonly environment: RuntimeEnvironment;
  readonly schemaVersion: 1;
  readonly version: number;
  readonly locale: string | null;
  readonly timezone: string | null;
  readonly theme: ThemePreference | null;
  readonly updatedAt: string;
}

export class UserPreferenceValidationError extends Error {
  constructor(readonly field: string) {
    super(`Invalid preference: ${field}`);
    this.name = "UserPreferenceValidationError";
  }
}

const fields: readonly PreferenceField[] = ["locale", "timezone", "theme"];

const validLocale = (value: string): boolean => {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
};

const validTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const allowed = (field: PreferenceField, value: unknown, policy: UserPreferencePolicy): value is string => {
  if (typeof value !== "string" || value.length === 0) return false;
  const contract: PreferenceValuePolicy<string> = policy[field];
  if (!contract.allowed.includes(value)) return false;
  if (field === "locale") return validLocale(value);
  if (field === "timezone") return validTimezone(value);
  return value === "light" || value === "dark" || value === "system";
};

/** The storage boundary accepts only the three baseline fields; null means explicitly unset. */
export const validateUserPreferencePatch = (
  input: unknown,
  policy: UserPreferencePolicy,
): UserPreferenceValues => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UserPreferenceValidationError("patch");
  }
  const values = input as Record<string, unknown>;
  const names = Object.keys(values);
  if (names.length === 0) throw new UserPreferenceValidationError("patch");
  const result: { locale?: string | null; timezone?: string | null; theme?: ThemePreference | null } = {};
  for (const name of names) {
    if (!fields.includes(name as PreferenceField)) {
      throw new UserPreferenceValidationError(name);
    }
    const field = name as PreferenceField;
    const value = values[field];
    if (value !== null && !allowed(field, value, policy)) {
      throw new UserPreferenceValidationError(field);
    }
    if (field === "locale") result.locale = value as string | null;
    if (field === "timezone") result.timezone = value as string | null;
    if (field === "theme") result.theme = value as ThemePreference | null;
  }
  return result;
};

const pick = (
  field: PreferenceField,
  policy: UserPreferencePolicy,
  user: unknown,
  device: unknown,
): { readonly value: string; readonly source: PreferenceSource } => {
  const contract: PreferenceValuePolicy<string> = policy[field];
  if (!allowed(field, contract.systemDefault, policy)) {
    throw new UserPreferenceValidationError(`policy.${field}.systemDefault`);
  }
  if (contract.forced !== undefined) {
    if (!allowed(field, contract.forced, policy)) {
      throw new UserPreferenceValidationError(`policy.${field}.forced`);
    }
    return { value: contract.forced, source: "forced" };
  }
  const candidates: readonly [PreferenceSource, unknown][] = [
    ["user", user],
    ["device", device],
    ["project", contract.projectDefault],
    ["system", contract.systemDefault],
  ];
  for (const [source, value] of candidates) {
    if (allowed(field, value, policy)) return { value, source };
  }
  // systemDefault is always valid; kept for exhaustiveness.
  throw new UserPreferenceValidationError(`policy.${field}`);
};

/** No browser access or persistence: caller passes authenticated state and browser/OS signals. */
export const resolveUserPreferences = (input: {
  readonly policy: UserPreferencePolicy;
  readonly authenticated: boolean;
  readonly user?: UserPreferenceValues | null;
  readonly device?: PreferenceDeviceSignals;
}): ResolvedUserPreferences => {
  const { policy, authenticated, device } = input;
  const user = authenticated ? input.user : null;
  const locale = pick("locale", policy, user?.locale, device?.locale);
  const timezone = pick("timezone", policy, user?.timezone, device?.timezone);
  const theme = pick(
    "theme", policy, user?.theme,
    device?.prefersDark === undefined ? undefined : device.prefersDark ? "dark" : "light",
  );
  const mode = theme.value as ThemePreference;
  return {
    locale: locale.value,
    timezone: timezone.value,
    theme: mode,
    colorScheme: mode === "system" ? (device?.prefersDark ? "dark" : "light") : mode,
    source: { locale: locale.source, timezone: timezone.source, theme: theme.source },
  };
};
