import type { AuthSnapshot } from "../auth/state";

export interface LoginIntent {
  readonly loginPath: string;
  readonly returnTo?: string;
  readonly href: string;
}

export type ProtectedRouteDecision =
  | { readonly kind: "pending" }
  | { readonly kind: "authenticated" }
  | { readonly kind: "unauthenticated"; readonly login: LoginIntent }
  | { readonly kind: "error"; readonly requestId?: string };

const isSafeInternalPath = (value: string) => {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return false;
  if (/\p{Cc}/u.test(value)) return false;
  try {
    const parsed = new URL(value, "https://route.invalid");
    return parsed.origin === "https://route.invalid" && parsed.pathname.startsWith("/");
  } catch {
    return false;
  }
};

const normalizeLoginPath = (value: string) => {
  if (!isSafeInternalPath(value)) throw new TypeError("loginPath must be a safe same-origin absolute path");
  const parsed = new URL(value, "https://route.invalid");
  if (parsed.search || parsed.hash) {
    throw new TypeError("loginPath must not contain query or fragment state");
  }
  return parsed.pathname;
};

const normalizeReturnTo = (value: string | undefined) => {
  if (!value || !isSafeInternalPath(value)) return undefined;
  const parsed = new URL(value, "https://route.invalid");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};

export const createLoginIntent = (loginPath: string, currentPath?: string): LoginIntent => {
  const normalizedLogin = normalizeLoginPath(loginPath);
  const returnTo = normalizeReturnTo(currentPath);
  const returnPathname = returnTo
    ? new URL(returnTo, "https://route.invalid").pathname
    : undefined;
  const safeReturnTo = returnPathname === normalizedLogin ? undefined : returnTo;
  const href = safeReturnTo
    ? `${normalizedLogin}?returnTo=${encodeURIComponent(safeReturnTo)}`
    : normalizedLogin;
  return Object.freeze({
    loginPath: normalizedLogin,
    ...(safeReturnTo ? { returnTo: safeReturnTo } : {}),
    href,
  });
};

export const evaluateProtectedRoute = (
  auth: Pick<AuthSnapshot, "status" | "requestId">,
  options: { readonly loginPath: string; readonly currentPath?: string },
): ProtectedRouteDecision => {
  switch (auth.status) {
    case "loading":
      return { kind: "pending" };
    case "authenticated":
      return { kind: "authenticated" };
    case "unauthenticated":
      return {
        kind: "unauthenticated",
        login: createLoginIntent(options.loginPath, options.currentPath),
      };
    case "error":
      return {
        kind: "error",
        ...(auth.requestId ? { requestId: auth.requestId } : {}),
      };
  }
};
