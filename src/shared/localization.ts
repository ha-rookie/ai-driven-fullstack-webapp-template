import type { ResolvedUserPreferences } from "./user-preferences";

/**
 * #289: presentation-only localization. #288 alone determines locale/timezone.
 * Domain values, authorization, business data and persisted preferences stay elsewhere.
 */
export type LocalizationPreferences = Pick<ResolvedUserPreferences, "locale" | "timezone">;
export type MessageCatalogs = Readonly<Record<string, Readonly<Record<string, string>>>>;
export type MessageArguments = Readonly<Record<string, string | number>>;
export type MissingMessageReason = "key" | "parameter";
export type MissingMessagePolicy = "fallback" | "throw";
export interface MissingMessage {
  readonly locale: string;
  readonly key: string;
  readonly reason: MissingMessageReason;
}

export interface LocalizationOptions {
  readonly preferences: LocalizationPreferences;
  readonly catalogs: MessageCatalogs;
  readonly fallbackLocale: string;
  /** Production-safe default: do not expose internal keys or interpolation tokens. */
  readonly missingMessagePolicy?: MissingMessagePolicy;
  readonly onMissing?: (diagnostic: MissingMessage) => void;
}

export interface Localization {
  /** Pure UI messages. Product business records must NOT be translated here. */
  readonly t: (key: string, args?: MessageArguments) => string;
  /** Input must be an ISO timestamp with explicit UTC/offset, never local wall time. */
  readonly formatDateTime: (timestamp: string, options?: Intl.DateTimeFormatOptions) => string;
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** Fractions: 0.125 means 12.5%, not 0.125%. */
  readonly formatPercent: (fraction: number, options?: Intl.NumberFormatOptions) => string;
  /** Caller supplies ISO 4217 code; locale is NOT a currency source or FX conversion. */
  readonly formatCurrency: (amount: number, currency: string, options?: Intl.NumberFormatOptions) => string;
  /** Plural rule extension point; catalog keys remain application-defined. */
  readonly selectPlural: (count: number) => Intl.LDMLPluralRule;
}

const MESSAGE_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u;
const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/gu;
const EXPLICIT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

export const createLocalization = (options: LocalizationOptions): Localization => {
  const { locale, timezone } = options.preferences;
  const { catalogs, fallbackLocale, onMissing } = options;
  const policy = options.missingMessagePolicy ?? "fallback";
  if (policy !== "fallback" && policy !== "throw") {
    throw new Error("Invalid missing message policy");
  }
  if (!locale || !timezone || !fallbackLocale || !hasOwn(catalogs, fallbackLocale)) {
    throw new Error("Localization requires #288 resolved locale/timezone and a fallback catalog");
  }

  // Fail at the boundary for unsupported or corrupted #288 signals.
  new Intl.DateTimeFormat(locale, { timeZone: timezone }).format(new Date(0));
  new Intl.NumberFormat(locale);
  new Intl.NumberFormat(fallbackLocale);

  const unavailable = (key: string, reason: MissingMessageReason): string => {
    onMissing?.({ key, reason, locale });
    if (policy === "throw") throw new Error("Missing localization " + reason + ": " + key);
    return locale.startsWith("ja") ? "メッセージを表示できません" : "Message unavailable";
  };

  const t = (key: string, args: MessageArguments = {}): string => {
    if (!MESSAGE_KEY.test(key)) throw new Error("Invalid localization message key");
    const selected = hasOwn(catalogs, locale) ? catalogs[locale] : undefined;
    const fallback = catalogs[fallbackLocale];
    const message = selected && hasOwn(selected, key) ? selected[key]
      : fallback && hasOwn(fallback, key) ? fallback[key] : undefined;
    if (typeof message !== "string" || message.length === 0) return unavailable(key, "key");
    let missingParameter = false;
    const result = message.replace(PLACEHOLDER, (_match, name: string) => {
      if (!hasOwn(args, name)) {
        missingParameter = true;
        return "";
      }
      return String(args[name]);
    });
    return missingParameter ? unavailable(key, "parameter") : result;
  };

  const dateTime: Localization["formatDateTime"] = (timestamp, formatOptions = {}) => {
    if (!EXPLICIT_TIMESTAMP.test(timestamp)) throw new Error("Expected an ISO timestamp with offset");
    const value = new Date(timestamp);
    if (!Number.isFinite(value.getTime())) throw new Error("Invalid timestamp");
    return new Intl.DateTimeFormat(locale, { ...formatOptions, timeZone: timezone }).format(value);
  };

  const number: Localization["formatNumber"] = (value, formatOptions = {}) => {
    if (!Number.isFinite(value)) throw new Error("Invalid number");
    return new Intl.NumberFormat(locale, { ...formatOptions, style: "decimal" }).format(value);
  };

  const percent: Localization["formatPercent"] = (fraction, formatOptions = {}) => {
    if (!Number.isFinite(fraction)) throw new Error("Invalid percent");
    return new Intl.NumberFormat(locale, { ...formatOptions, style: "percent" }).format(fraction);
  };

  const currency: Localization["formatCurrency"] = (amount, code, formatOptions = {}) => {
    if (!Number.isFinite(amount) || !/^[A-Z]{3}$/u.test(code)) {
      throw new Error("Explicit ISO 4217 currency code and finite amount required");
    }
    return new Intl.NumberFormat(locale, { ...formatOptions, style: "currency", currency: code }).format(amount);
  };

  const selectPlural: Localization["selectPlural"] = count => {
    if (!Number.isFinite(count)) throw new Error("Invalid plural count");
    return new Intl.PluralRules(locale).select(count);
  };

  return { t, formatDateTime: dateTime, formatNumber: number, formatPercent: percent,
    formatCurrency: currency, selectPlural };
};
