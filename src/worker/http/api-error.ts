import { AppError } from "../../shared/errors";
import type { ValidationIssue } from "../../shared/validation";

export interface ApiErrorDescriptor {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly issues?: readonly ValidationIssue[];
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly issues?: readonly ValidationIssue[];
  };
  readonly requestId: string;
}

const appErrorStatusByCode: Readonly<Record<string, number>> = {
  bad_request: 400,
  invalid_request: 400,
  invalid_path: 400,
  authentication_required: 401,
  forbidden: 403,
  not_found: 404,
  resource_not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  stale_update: 409,
  resource_immutable: 409,
  state_changed: 409,
  invalid_transition: 409,
  validation_failed: 422,
  rate_limited: 429,
  authentication_unavailable: 503,
  resource_unavailable: 503,
  mutation_unavailable: 503,
};

const publicMessageForStatus = (status: number): string => {
  switch (status) {
    case 400:
      return "Invalid request";
    case 401:
      return "Authentication required";
    case 403:
      return "Access denied";
    case 404:
      return "Resource not found";
    case 405:
      return "Method not allowed";
    case 409:
      return "Conflict";
    case 422:
      return "Validation failed";
    case 429:
      return "Too many requests";
    case 503:
      return "Service unavailable";
    default:
      return "Internal server error";
  }
};

export const apiErrorResponse = (
  descriptor: ApiErrorDescriptor,
  requestId: string,
): Response => {
  const envelope: ApiErrorEnvelope = {
    error: {
      code: descriptor.code,
      message: descriptor.message,
      ...(descriptor.issues ? { issues: descriptor.issues } : {}),
    },
    requestId,
  };

  return new Response(
    JSON.stringify({
      ...(descriptor.extra ?? {}),
      ...envelope,
    }),
    {
      status: descriptor.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-request-id": requestId,
      },
    },
  );
};

export const appErrorResponse = (
  error: AppError,
  requestId: string,
): Response => {
  const status = appErrorStatusByCode[error.code] ?? 500;
  const internal = status >= 500;

  return apiErrorResponse(
    {
      status,
      code: status === 500 ? "internal_error" : error.code,
      message: internal
        ? publicMessageForStatus(status)
        : (error.userMessage ?? publicMessageForStatus(status)),
    },
    requestId,
  );
};

export const validationErrorResponse = (
  issues: readonly ValidationIssue[],
  requestId: string,
): Response =>
  apiErrorResponse(
    {
      status: 422,
      code: "validation_failed",
      message: "Validation failed",
      issues,
    },
    requestId,
  );

export const mapApiError = (error: unknown, requestId: string): Response =>
  error instanceof AppError
    ? appErrorResponse(error, requestId)
    : apiErrorResponse(
        {
          status: 500,
          code: "internal_error",
          message: "Internal server error",
        },
        requestId,
      );
