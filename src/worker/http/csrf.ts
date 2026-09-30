import { readSessionToken } from "../auth";
import { apiErrorResponse } from "./api-error";

export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_TOKEN_PREFIX = "v1.";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const encoder = new TextEncoder();
const csrfTokenPattern = /^v1\.[A-Za-z0-9_-]{43}$/;

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
};

export const isCsrfSafeMethod = (method: string): boolean =>
  SAFE_METHODS.has(method.toUpperCase());

export const deriveCsrfToken = async (sessionToken: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`csrf:v1:${sessionToken}`),
  );
  return `${CSRF_TOKEN_PREFIX}${base64Url(new Uint8Array(digest))}`;
};

export const issueCsrfTokenForRequest = async (
  request: Request,
): Promise<string | null> => {
  const sessionToken = readSessionToken(request);
  return sessionToken ? deriveCsrfToken(sessionToken) : null;
};

export interface CsrfGuardFailure {
  readonly allowed: false;
  readonly status: 403;
  readonly code: "csrf_failed";
  readonly message: "CSRF validation failed";
  readonly reason: "csrf_proof_missing_or_invalid";
}

export type CsrfGuardResult =
  | {
      readonly allowed: true;
      readonly reason: "safe_method" | "session_cookie_absent" | "valid_proof";
    }
  | CsrfGuardFailure;

const csrfFailure = (): CsrfGuardFailure => ({
  allowed: false,
  status: 403,
  code: "csrf_failed",
  message: "CSRF validation failed",
  reason: "csrf_proof_missing_or_invalid",
});

export const requireCsrfProtection = async (
  request: Request,
): Promise<CsrfGuardResult> => {
  if (isCsrfSafeMethod(request.method)) {
    return { allowed: true, reason: "safe_method" };
  }

  const sessionToken = readSessionToken(request);
  if (!sessionToken) {
    return { allowed: true, reason: "session_cookie_absent" };
  }

  const provided = request.headers.get(CSRF_HEADER_NAME);
  if (!provided || !csrfTokenPattern.test(provided)) {
    return csrfFailure();
  }

  const expected = await deriveCsrfToken(sessionToken);
  return constantTimeEqual(provided, expected)
    ? { allowed: true, reason: "valid_proof" }
    : csrfFailure();
};

export const csrfGuardFailureResponse = (
  failure: CsrfGuardFailure,
  requestId: string,
): Response =>
  apiErrorResponse(
    {
      status: failure.status,
      code: failure.code,
      message: failure.message,
    },
    requestId,
  );
