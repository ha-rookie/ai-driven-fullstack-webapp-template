export interface ValidationIssue {
  readonly code: string;
  readonly path?: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly ValidationIssue[] };

export const valid = (): ValidationResult => ({
  valid: true,
  issues: [],
});

export const invalid = (
  ...issues: readonly ValidationIssue[]
): ValidationResult => ({
  valid: false,
  issues,
});

export const combineValidationResults = (
  ...results: readonly ValidationResult[]
): ValidationResult => {
  const issues = results.flatMap((result) => result.issues);
  return issues.length === 0 ? valid() : invalid(...issues);
};
