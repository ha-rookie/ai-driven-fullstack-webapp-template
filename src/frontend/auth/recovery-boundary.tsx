import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuth } from "./context";
import {
  createRuntimeReauthController,
  type RuntimeReauthController,
  type RuntimeReauthSnapshot,
} from "./recovery";

export interface RuntimeReauthContextValue extends RuntimeReauthSnapshot {
  readonly reportAuthenticationFailure: (error: unknown) => Promise<boolean>;
  readonly retryReauthentication: () => Promise<RuntimeReauthSnapshot>;
  readonly acknowledgeRecovery: () => void;
  readonly resetAfterLogout: () => void;
}

export interface RuntimeReauthBoundaryProps extends PropsWithChildren {
  readonly beginReauthentication: () => void | Promise<void>;
  readonly renderOverlay?: (value: RuntimeReauthContextValue) => ReactNode;
}

const RuntimeReauthContext = createContext<RuntimeReauthContextValue | null>(null);

const DefaultRecoveryOverlay = ({ value }: { readonly value: RuntimeReauthContextValue }) => {
  if (value.status === "idle") return null;

  if (value.status === "recovering") {
    return (
      <aside role="status" aria-live="assertive">
        <p>Your session expired. Sign in again to continue.</p>
      </aside>
    );
  }

  if (value.status === "failed") {
    return (
      <aside role="alert" aria-live="assertive">
        <p>Authentication could not be restored. Your current work has been kept.</p>
        <button type="button" onClick={() => void value.retryReauthentication()}>
          Try signing in again
        </button>
      </aside>
    );
  }

  return (
    <aside role="status" aria-live="polite">
      <p>Authentication was restored. Review your changes and submit again when ready.</p>
      <button type="button" onClick={value.acknowledgeRecovery}>
        Continue
      </button>
    </aside>
  );
};

export const RuntimeReauthBoundary = ({
  children,
  beginReauthentication,
  renderOverlay,
}: RuntimeReauthBoundaryProps) => {
  const auth = useAuth();
  const [controller] = useState<RuntimeReauthController>(() => createRuntimeReauthController({
    beginReauthentication,
    synchronize: auth.synchronize,
  }));
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const value: RuntimeReauthContextValue = {
    ...snapshot,
    reportAuthenticationFailure: controller.handle,
    retryReauthentication: controller.retry,
    acknowledgeRecovery: controller.acknowledge,
    resetAfterLogout: controller.resetAfterLogout,
  };

  return (
    <RuntimeReauthContext.Provider value={value}>
      {children}
      {renderOverlay ? renderOverlay(value) : <DefaultRecoveryOverlay value={value} />}
    </RuntimeReauthContext.Provider>
  );
};

export const useRuntimeReauth = (): RuntimeReauthContextValue => {
  const value = useContext(RuntimeReauthContext);
  if (!value) throw new Error("useRuntimeReauth must be used within RuntimeReauthBoundary");
  return value;
};
