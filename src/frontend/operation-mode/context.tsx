import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createOperationModeController,
  type OperationModeController,
  type OperationModeLoader,
  type OperationModeSnapshot,
} from "./state";

export interface OperationModeContextValue extends OperationModeSnapshot {
  readonly refresh: () => Promise<OperationModeSnapshot>;
}

export interface OperationModeProviderProps extends PropsWithChildren {
  readonly loader: OperationModeLoader;
  readonly controller?: OperationModeController;
  readonly refreshOnFocus?: boolean;
}

export interface OperationModeIndicatorCopy {
  readonly readOnly: string;
  readonly maintenance: string;
  readonly stale: string;
  readonly unavailable: string;
}

export interface OperationModeBannerProps {
  readonly snapshot: OperationModeSnapshot;
  readonly copy?: Partial<OperationModeIndicatorCopy>;
  readonly actions?: ReactNode;
}

const defaultCopy: OperationModeIndicatorCopy = Object.freeze({
  readOnly: "This service is temporarily read-only. Changes cannot be saved.",
  maintenance: "This service is under maintenance. Some operations are unavailable.",
  stale: "Service status could not be refreshed. The displayed status may be out of date.",
  unavailable: "Service status is temporarily unavailable.",
});

const OperationModeContext = createContext<OperationModeContextValue | null>(null);

export const OperationModeBanner = ({ snapshot, copy, actions }: OperationModeBannerProps) => {
  const text = { ...defaultCopy, ...copy };
  if (snapshot.status === "loading") return null;
  if (snapshot.status === "error" || !snapshot.state) {
    return (
      <aside role="status" aria-live="polite" data-operation-mode="unknown">
        <p>{text.unavailable}</p>
        {actions}
      </aside>
    );
  }

  if (snapshot.stale) {
    return (
      <aside role="status" aria-live="polite" data-operation-mode={snapshot.state.mode} data-operation-mode-stale="true">
        <p>{text.stale}</p>
        {actions}
      </aside>
    );
  }

  if (snapshot.state.mode === "normal") return null;
  if (snapshot.state.mode === "maintenance") {
    return (
      <aside role="alert" aria-live="assertive" data-operation-mode="maintenance">
        <p>{text.maintenance}</p>
        {actions}
      </aside>
    );
  }

  return (
    <aside role="status" aria-live="polite" data-operation-mode="read-only">
      <p>{text.readOnly}</p>
      {actions}
    </aside>
  );
};

export const OperationModeProvider = ({
  children,
  loader,
  controller: providedController,
  refreshOnFocus = true,
}: OperationModeProviderProps) => {
  const [controller] = useState<OperationModeController>(() =>
    providedController ?? createOperationModeController(loader),
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.bootstrap();
  }, [controller]);

  useEffect(() => {
    if (!refreshOnFocus || typeof window === "undefined") return undefined;
    const onFocus = () => { void controller.refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [controller, refreshOnFocus]);

  const value: OperationModeContextValue = {
    ...snapshot,
    refresh: controller.refresh,
  };

  return <OperationModeContext.Provider value={value}>{children}</OperationModeContext.Provider>;
};

export const useOperationMode = (): OperationModeContextValue => {
  const value = useContext(OperationModeContext);
  if (!value) throw new Error("useOperationMode must be used within OperationModeProvider");
  return value;
};

export const OperationModeIndicator = ({
  copy,
}: { readonly copy?: Partial<OperationModeIndicatorCopy> }) => {
  const mode = useOperationMode();
  return <OperationModeBanner snapshot={mode} copy={copy} />;
};
