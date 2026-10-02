import { ApiClientError } from "../api";

export type ErrorPresentationKind =
  | "validation"
  | "authentication_required"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "service_unavailable"
  | "network"
  | "timeout"
  | "protocol"
  | "aborted"
  | "unknown";

export type ErrorRecovery = "none" | "retry" | "refresh" | "reauthenticate" | "correct_input";

export interface FieldErrorViewModel {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ErrorViewModel {
  readonly kind: ErrorPresentationKind;
  readonly title: string;
  readonly message: string;
  readonly recovery: ErrorRecovery;
  readonly requestId?: string;
  readonly fields: readonly FieldErrorViewModel[];
}

export interface ErrorCopy {
  readonly title: string;
  readonly message: string;
  readonly fieldMessage?: string;
}

export type ErrorCopyResolver = (
  kind: ErrorPresentationKind,
  context: { readonly status?: number; readonly code?: string },
) => ErrorCopy | undefined;

const defaults: Readonly<Record<ErrorPresentationKind, ErrorCopy>> = Object.freeze({
  validation: { title: "Check the entered values", message: "Some values need attention.", fieldMessage: "Check this value." },
  authentication_required: { title: "Sign in required", message: "Your session is not available. Sign in again to continue." },
  forbidden: { title: "Access denied", message: "You do not have permission to perform this action." },
  not_found: { title: "Not found", message: "The requested item could not be found." },
  conflict: { title: "Data changed", message: "The data changed before this operation completed. Refresh before trying again." },
  rate_limited: { title: "Too many requests", message: "Please wait before trying again." },
  service_unavailable: { title: "Service unavailable", message: "The service could not complete the request." },
  network: { title: "Connection problem", message: "The request could not reach the service." },
  timeout: { title: "Request timed out", message: "The service did not respond in time." },
  protocol: { title: "Unexpected response", message: "The service returned an unexpected response." },
  aborted: { title: "Request cancelled", message: "The request was cancelled." },
  unknown: { title: "Something went wrong", message: "The operation could not be completed." },
});

const classifyHttp = (error: ApiClientError): ErrorPresentationKind => {
  const hasIssues = (error.apiError?.error.issues?.length ?? 0) > 0;
  if (hasIssues && error.status !== 401 && error.status !== 403) return "validation";
  switch (error.status) {
    case 401:
      return "authentication_required";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 429:
      return "rate_limited";
    default:
      return error.status !== undefined && error.status >= 500
        ? "service_unavailable"
        : "unknown";
  }
};

const recoveryFor = (kind: ErrorPresentationKind): ErrorRecovery => {
  switch (kind) {
    case "validation":
      return "correct_input";
    case "authentication_required":
      return "reauthenticate";
    case "conflict":
      return "refresh";
    case "rate_limited":
    case "service_unavailable":
    case "network":
    case "timeout":
      return "retry";
    default:
      return "none";
  }
};

const safeRequestId = (value: string | undefined) => {
  if (!value) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128 ? normalized : undefined;
};

const safeFieldPath = (value: string | undefined) => {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) return undefined;
  if (!/^[A-Za-z0-9_.\[\]-]+$/.test(normalized)) return undefined;
  return normalized;
};

export const toErrorViewModel = (
  error: unknown,
  resolveCopy?: ErrorCopyResolver,
): ErrorViewModel => {
  let kind: ErrorPresentationKind = "unknown";
  let status: number | undefined;
  let code: string | undefined;
  let requestId: string | undefined;
  let issues: readonly { readonly path?: string; readonly code: string }[] = [];

  if (error instanceof ApiClientError) {
    status = error.status;
    requestId = safeRequestId(error.requestId ?? error.apiError?.requestId);
    code = error.apiError?.error.code;
    issues = error.apiError?.error.issues ?? [];
    switch (error.kind) {
      case "http":
        kind = classifyHttp(error);
        break;
      case "network":
        kind = "network";
        break;
      case "timeout":
        kind = "timeout";
        break;
      case "protocol":
        kind = "protocol";
        break;
      case "aborted":
        kind = "aborted";
        break;
    }
  }

  const copy = resolveCopy?.(kind, { status, code }) ?? defaults[kind];
  const fieldMessage = copy.fieldMessage ?? defaults.validation.fieldMessage ?? "Check this value.";
  const fields = kind === "validation"
    ? issues.flatMap((issue) => {
        const path = safeFieldPath(issue.path);
        return path ? [{ path, code: issue.code, message: fieldMessage }] : [];
      })
    : [];

  return Object.freeze({
    kind,
    title: copy.title,
    message: copy.message,
    recovery: recoveryFor(kind),
    ...(requestId ? { requestId } : {}),
    fields: Object.freeze(fields),
  });
};
