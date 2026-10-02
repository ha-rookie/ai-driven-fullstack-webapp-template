import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createAuthApiLoader,
  createAuthController,
  type AuthController,
  type AuthLoader,
  type AuthSnapshot,
} from "./state";

export interface AuthContextValue extends AuthSnapshot {
  readonly synchronize: () => Promise<AuthSnapshot>;
  readonly resetAfterLogout: () => void;
}

export interface AuthProviderProps extends PropsWithChildren {
  readonly loader?: AuthLoader;
  readonly controller?: AuthController;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children, loader, controller: providedController }: AuthProviderProps) => {
  const [controller] = useState<AuthController>(() =>
    providedController ?? createAuthController(loader ?? createAuthApiLoader()),
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.bootstrap();
  }, [controller]);

  const value: AuthContextValue = {
    ...snapshot,
    synchronize: controller.synchronize,
    resetAfterLogout: controller.resetAfterLogout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
};
