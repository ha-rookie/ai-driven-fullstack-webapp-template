export type ApiVersionStrategy =
  | { readonly kind: "none" }
  | { readonly kind: "url" }
  | { readonly kind: "header"; readonly headerName: string };

export type ApiChangeCategory =
  | "add_endpoint"
  | "add_optional_request_field"
  | "add_optional_response_field"
  | "broaden_accepted_values"
  | "remove_endpoint"
  | "remove_request_field"
  | "remove_response_field"
  | "rename_field"
  | "change_field_type"
  | "make_request_field_required"
  | "narrow_accepted_values"
  | "change_auth_requirement"
  | "change_error_semantics"
  | "change_pagination_semantics";

export type ApiChangeCompatibility = "breaking" | "non_breaking";

export interface ApiDeprecationNotice {
  readonly version: string;
  readonly message: string;
  readonly removalCondition: string;
  readonly migrationGuide?: string;
}

export interface ApiVersionPolicy {
  readonly strategy: ApiVersionStrategy;
  readonly supportedVersions: readonly string[];
  readonly currentVersion: string;
  readonly defaultVersion: string;
  readonly deprecations: readonly ApiDeprecationNotice[];
}

export interface ApiVersionPolicyInput {
  readonly strategy: ApiVersionStrategy;
  readonly supportedVersions: readonly string[];
  readonly currentVersion: string;
  readonly defaultVersion: string;
  readonly deprecations?: readonly ApiDeprecationNotice[];
}

export type ApiVersionResolution =
  | {
      readonly ok: true;
      readonly version: string;
      readonly deprecation: ApiDeprecationNotice | null;
    }
  | {
      readonly ok: false;
      readonly code: "unsupported_api_version";
      readonly requestedVersion: string;
      readonly supportedVersions: readonly string[];
    };

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const breakingChanges = new Set<ApiChangeCategory>([
  "remove_endpoint",
  "remove_request_field",
  "remove_response_field",
  "rename_field",
  "change_field_type",
  "make_request_field_required",
  "narrow_accepted_values",
  "change_auth_requirement",
  "change_error_semantics",
  "change_pagination_semantics",
]);

export const classifyApiChange = (
  category: ApiChangeCategory,
): ApiChangeCompatibility => breakingChanges.has(category) ? "breaking" : "non_breaking";

const isVersionToken = (value: string): boolean => VERSION_PATTERN.test(value);

const nonEmptyBounded = (value: string, max: number): boolean =>
  value.trim().length > 0 && value.length <= max;

export const createApiVersionPolicy = (
  input: ApiVersionPolicyInput,
): ApiVersionPolicy => {
  if (input.supportedVersions.length === 0) {
    throw new TypeError("supportedVersions must contain at least one version");
  }
  if (new Set(input.supportedVersions).size !== input.supportedVersions.length) {
    throw new TypeError("supportedVersions must not contain duplicates");
  }
  if (input.supportedVersions.some((version) => !isVersionToken(version))) {
    throw new TypeError("supportedVersions contains an invalid version token");
  }
  if (!input.supportedVersions.includes(input.currentVersion)) {
    throw new TypeError("currentVersion must be included in supportedVersions");
  }
  if (!input.supportedVersions.includes(input.defaultVersion)) {
    throw new TypeError("defaultVersion must be included in supportedVersions");
  }
  if (input.strategy.kind === "none" && input.supportedVersions.length !== 1) {
    throw new TypeError("strategy none can only expose one supported version");
  }
  if (
    input.strategy.kind === "header"
    && (!nonEmptyBounded(input.strategy.headerName, 128)
      || !HEADER_NAME_PATTERN.test(input.strategy.headerName))
  ) {
    throw new TypeError("headerName must be a valid HTTP header name");
  }

  const deprecations = input.deprecations ?? [];
  if (new Set(deprecations.map((notice) => notice.version)).size !== deprecations.length) {
    throw new TypeError("deprecations must not contain duplicate versions");
  }
  for (const notice of deprecations) {
    if (!input.supportedVersions.includes(notice.version)) {
      throw new TypeError("deprecation version must be included in supportedVersions");
    }
    if (notice.version === input.currentVersion) {
      throw new TypeError("currentVersion must not be deprecated");
    }
    if (!nonEmptyBounded(notice.message, 500)) {
      throw new TypeError("deprecation message must be non-empty and bounded");
    }
    if (!nonEmptyBounded(notice.removalCondition, 500)) {
      throw new TypeError("deprecation removalCondition must be non-empty and bounded");
    }
    if (
      notice.migrationGuide !== undefined
      && !nonEmptyBounded(notice.migrationGuide, 2048)
    ) {
      throw new TypeError("deprecation migrationGuide must be non-empty and bounded");
    }
  }

  return Object.freeze({
    strategy: Object.freeze({ ...input.strategy }),
    supportedVersions: Object.freeze([...input.supportedVersions]),
    currentVersion: input.currentVersion,
    defaultVersion: input.defaultVersion,
    deprecations: Object.freeze(deprecations.map((notice) => Object.freeze({ ...notice }))),
  });
};

export const resolveApiVersion = (
  requestedVersion: string | null | undefined,
  policy: ApiVersionPolicy,
): ApiVersionResolution => {
  const version = requestedVersion ?? policy.defaultVersion;
  if (!policy.supportedVersions.includes(version)) {
    return {
      ok: false,
      code: "unsupported_api_version",
      requestedVersion: version,
      supportedVersions: policy.supportedVersions,
    };
  }

  return {
    ok: true,
    version,
    deprecation: policy.deprecations.find((notice) => notice.version === version) ?? null,
  };
};
