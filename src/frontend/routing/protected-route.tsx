import type { PropsWithChildren, ReactNode } from "react";
import { useAuth } from "../auth";
import { evaluateProtectedRoute, type LoginIntent } from "./policy";

export interface ProtectedRouteProps extends PropsWithChildren {
  readonly loginPath: string;
  readonly currentPath?: string;
  readonly pending?: ReactNode;
  readonly renderUnauthenticated: (intent: LoginIntent) => ReactNode;
  readonly renderError?: (requestId?: string) => ReactNode;
}

export const ProtectedRoute = ({
  children,
  loginPath,
  currentPath,
  pending = null,
  renderUnauthenticated,
  renderError,
}: ProtectedRouteProps) => {
  const auth = useAuth();
  const decision = evaluateProtectedRoute(auth, { loginPath, currentPath });

  switch (decision.kind) {
    case "pending":
      return <>{pending}</>;
    case "authenticated":
      return <>{children}</>;
    case "unauthenticated":
      return <>{renderUnauthenticated(decision.login)}</>;
    case "error":
      return <>{renderError?.(decision.requestId) ?? null}</>;
  }
};
