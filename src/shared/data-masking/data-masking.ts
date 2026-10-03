const EMAIL_MASK = "***";
const PHONE_VISIBLE_SUFFIX_DIGITS = 4;

export type DataExposureDecision = "reveal" | "mask" | "omit";

export interface SensitiveStringFieldPolicy<Context> {
  decide(context: Context): DataExposureDecision;
}

export type SensitiveStringMasker = (value: string) => string;

export interface SensitiveStringFieldRule<Context> {
  readonly policy: SensitiveStringFieldPolicy<Context>;
  readonly mask: SensitiveStringMasker;
}

export interface PresentedSensitiveString {
  readonly decision: DataExposureDecision;
  readonly value?: string;
}

export type SensitiveStringFieldRules<Context> = Readonly<
  Record<string, SensitiveStringFieldRule<Context>>
>;

const isDataExposureDecision = (value: unknown): value is DataExposureDecision =>
  value === "reveal" || value === "mask" || value === "omit";

/**
 * Masks an email address for display while keeping the domain recognizable.
 * Invalid or incomplete input is replaced with a fixed mask instead of being
 * returned unchanged.
 */
export const maskEmail = (value: string): string => {
  const separatorIndex = value.lastIndexOf("@");
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
    return EMAIL_MASK;
  }

  const localPart = value.slice(0, separatorIndex);
  const domainPart = value.slice(separatorIndex + 1);
  const localCharacters = Array.from(localPart);
  const visiblePrefix = localCharacters.length >= 2 ? localCharacters[0] : "";

  return `${visiblePrefix}${EMAIL_MASK}@${domainPart}`;
};

/**
 * Masks all phone-number digits except the final four digits. Separators are
 * preserved to keep the display readable. Very short or digit-free input is
 * never returned unchanged.
 */
export const maskPhone = (value: string): string => {
  const digitCount = Array.from(value).filter((character) => /[0-9]/.test(character)).length;
  if (digitCount === 0) return EMAIL_MASK;

  const visibleSuffixDigits =
    digitCount > PHONE_VISIBLE_SUFFIX_DIGITS ? PHONE_VISIBLE_SUFFIX_DIGITS : 0;
  let digitIndex = 0;
  const revealFrom = digitCount - visibleSuffixDigits;

  return Array.from(value, (character) => {
    if (!/[0-9]/.test(character)) return character;
    const currentDigitIndex = digitIndex;
    digitIndex += 1;
    return currentDigitIndex >= revealFrom ? character : "*";
  }).join("");
};

/**
 * Converts one sensitive string into a response-safe representation.
 *
 * Fail-closed behavior:
 * - policy failure or an unknown runtime decision => omit
 * - masker failure => omit
 * - a masker returning the original non-empty value => omit
 *
 * Only an explicit `reveal` decision can return the original value.
 */
export const presentSensitiveString = <Context>(
  value: string,
  context: Context,
  rule: SensitiveStringFieldRule<Context>,
): PresentedSensitiveString => {
  try {
    const decision = rule.policy.decide(context);
    if (!isDataExposureDecision(decision)) {
      return { decision: "omit" };
    }

    if (decision === "omit") {
      return { decision };
    }

    if (decision === "reveal") {
      return { decision, value };
    }

    const maskedValue = rule.mask(value);
    if (value.length > 0 && maskedValue === value) {
      return { decision: "omit" };
    }

    return { decision, value: maskedValue };
  } catch {
    return { decision: "omit" };
  }
};

/**
 * Applies explicit masking rules to a flat API DTO.
 *
 * Fields without a rule are copied unchanged. A field declared sensitive by a
 * rule is omitted when its runtime value is not a string or when policy/mask
 * evaluation fails. The source object is never mutated.
 */
export const applyStringFieldPolicies = <
  RecordType extends Readonly<Record<string, unknown>>,
  Context,
>(
  source: RecordType,
  context: Context,
  rules: SensitiveStringFieldRules<Context>,
): Partial<RecordType> => {
  const output: Record<string, unknown> = { ...source };

  for (const [field, rule] of Object.entries(rules)) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;

    const sourceValue = source[field];
    if (sourceValue === null || sourceValue === undefined) continue;

    if (typeof sourceValue !== "string") {
      delete output[field];
      continue;
    }

    const presented = presentSensitiveString(sourceValue, context, rule);
    if (presented.value === undefined) {
      delete output[field];
      continue;
    }

    output[field] = presented.value;
  }

  return output as Partial<RecordType>;
};
