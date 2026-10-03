const FIXED_MASK = "***";
const PHONE_VISIBLE_SUFFIX_DIGITS = 4;
const PHONE_ALLOWED_CHARACTER_PATTERN = /^[0-9+().\-\s]+$/;

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
 * Malformed or incomplete input is replaced with a fixed mask instead of being
 * partially echoed.
 */
export const maskEmail = (value: string): string => {
  const separatorIndex = value.indexOf("@");
  const hasSingleSeparator =
    separatorIndex > 0
    && separatorIndex === value.lastIndexOf("@")
    && separatorIndex < value.length - 1;

  if (!hasSingleSeparator || /\s/.test(value)) {
    return FIXED_MASK;
  }

  const localPart = value.slice(0, separatorIndex);
  const domainPart = value.slice(separatorIndex + 1);
  const localCharacters = Array.from(localPart);
  const visiblePrefix = localCharacters.length >= 2 ? localCharacters[0] : "";

  return `${visiblePrefix}${FIXED_MASK}@${domainPart}`;
};

/**
 * Masks all phone-number digits except the final four digits. Common phone
 * separators are preserved for readability. Unexpected characters cause a
 * fixed mask so malformed input is never partially echoed.
 */
export const maskPhone = (value: string): string => {
  if (!PHONE_ALLOWED_CHARACTER_PATTERN.test(value)) return FIXED_MASK;

  const digitCount = Array.from(value).filter((character) => /[0-9]/.test(character)).length;
  if (digitCount === 0) return FIXED_MASK;

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
