export type ConcurrencyPreconditionSource = "body" | "if-match" | "both";

export interface ConcurrencyPrecondition {
  readonly expectedVersion: number;
  readonly source: ConcurrencyPreconditionSource;
}

export interface ConcurrencyPreconditionFailure {
  readonly ok: false;
  readonly status: 400 | 428;
  readonly code: "invalid_precondition" | "precondition_required";
  readonly message: string;
  readonly reason:
    | "missing"
    | "malformed_if_match"
    | "invalid_body_version"
    | "conflicting_versions";
}

export type ConcurrencyPreconditionResult =
  | { readonly ok: true; readonly precondition: ConcurrencyPrecondition }
  | ConcurrencyPreconditionFailure;

export interface StalePreconditionHttpMapping {
  readonly status: 409 | 412;
  readonly code: "stale_update" | "precondition_failed";
  readonly message: "The resource changed after it was read";
}

const isPositiveVersion = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 1;

const parseStrongVersionEtag = (value: string): number | null => {
  const match = value.match(/^"v([1-9][0-9]*)"$/);
  if (!match) return null;

  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
};

export const formatVersionEtag = (version: number): string => {
  if (!isPositiveVersion(version)) {
    throw new Error("Version ETag requires a positive safe integer");
  }

  return `"v${version}"`;
};

export const resolveConcurrencyPrecondition = (
  request: Request,
  bodyExpectedVersion: unknown,
): ConcurrencyPreconditionResult => {
  const ifMatch = request.headers.get("if-match");
  const hasBodyVersion = bodyExpectedVersion !== undefined;

  let headerVersion: number | null = null;
  if (ifMatch !== null) {
    headerVersion = parseStrongVersionEtag(ifMatch.trim());
    if (headerVersion === null) {
      return {
        ok: false,
        status: 400,
        code: "invalid_precondition",
        message: "Concurrency precondition is invalid",
        reason: "malformed_if_match",
      };
    }
  }

  if (hasBodyVersion && !isPositiveVersion(bodyExpectedVersion)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_precondition",
      message: "Concurrency precondition is invalid",
      reason: "invalid_body_version",
    };
  }

  if (headerVersion === null && !hasBodyVersion) {
    return {
      ok: false,
      status: 428,
      code: "precondition_required",
      message: "A concurrency precondition is required",
      reason: "missing",
    };
  }

  if (
    headerVersion !== null &&
    hasBodyVersion &&
    headerVersion !== bodyExpectedVersion
  ) {
    return {
      ok: false,
      status: 400,
      code: "invalid_precondition",
      message: "Concurrency precondition is invalid",
      reason: "conflicting_versions",
    };
  }

  if (headerVersion !== null && hasBodyVersion) {
    return {
      ok: true,
      precondition: {
        expectedVersion: headerVersion,
        source: "both",
      },
    };
  }

  if (headerVersion !== null) {
    return {
      ok: true,
      precondition: {
        expectedVersion: headerVersion,
        source: "if-match",
      },
    };
  }

  return {
    ok: true,
    precondition: {
      expectedVersion: bodyExpectedVersion as number,
      source: "body",
    },
  };
};

export const stalePreconditionHttpMapping = (
  precondition: ConcurrencyPrecondition,
): StalePreconditionHttpMapping =>
  precondition.source === "body"
    ? {
        status: 409,
        code: "stale_update",
        message: "The resource changed after it was read",
      }
    : {
        status: 412,
        code: "precondition_failed",
        message: "The resource changed after it was read",
      };
