import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import { useAuth, type AuthUser } from "../auth";

export type FrontendPermission = string;

export type PermissionEvaluator = (
  permission: FrontendPermission,
  user: AuthUser,
) => boolean;

export interface PermissionContextValue {
  readonly can: (permission: FrontendPermission) => boolean;
}

export interface PermissionProviderProps extends PropsWithChildren {
  readonly evaluate: PermissionEvaluator;
}

export interface PermissionGuardProps extends PropsWithChildren {
  readonly permission: FrontendPermission;
  readonly fallback?: ReactNode;
}

const PermissionContext = createContext<PermissionContextValue | null>(null);

const validPermission = (permission: FrontendPermission) => {
  const normalized = permission.trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw new TypeError("permission must be a bounded non-empty string");
  }
  return normalized;
};

export const PermissionProvider = ({ children, evaluate }: PermissionProviderProps) => {
  const auth = useAuth();
  const value = useMemo<PermissionContextValue>(() => ({
    can(permission) {
      const normalized = validPermission(permission);
      if (auth.status !== "authenticated" || !auth.user) return false;
      try {
        return evaluate(normalized, auth.user) === true;
      } catch {
        return false;
      }
    },
  }), [auth.status, auth.user, evaluate]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
};

export const usePermission = (): PermissionContextValue => {
  const value = useContext(PermissionContext);
  if (!value) throw new Error("usePermission must be used within PermissionProvider");
  return value;
};

export const PermissionGuard = ({ permission, children, fallback = null }: PermissionGuardProps) => {
  const permissions = usePermission();
  return permissions.can(permission) ? <>{children}</> : <>{fallback}</>;
};
