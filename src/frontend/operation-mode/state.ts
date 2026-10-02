export type FrontendOperationMode = "normal" | "read-only" | "maintenance";

export interface FrontendOperationModeState {
  readonly mode: FrontendOperationMode;
  readonly version: number;
  readonly updatedAt?: string;
}

export type OperationModeLoadStatus = "loading" | "ready" | "error";

export interface OperationModeSnapshot {
  readonly status: OperationModeLoadStatus;
  readonly state: FrontendOperationModeState | null;
  readonly refreshing: boolean;
  readonly stale: boolean;
}

export type OperationModeLoader = () => Promise<FrontendOperationModeState>;

export interface OperationModeController {
  getSnapshot(): OperationModeSnapshot;
  subscribe(listener: () => void): () => void;
  bootstrap(): Promise<OperationModeSnapshot>;
  refresh(): Promise<OperationModeSnapshot>;
}

const isMode = (value: unknown): value is FrontendOperationMode =>
  value === "normal" || value === "read-only" || value === "maintenance";

export const validateFrontendOperationModeState = (value: unknown): FrontendOperationModeState => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Operation mode state must be an object");
  }
  const record = value as Record<string, unknown>;
  if (!isMode(record.mode) || typeof record.version !== "number" ||
      !Number.isSafeInteger(record.version) || record.version < 1) {
    throw new TypeError("Operation mode state is invalid");
  }
  if (record.updatedAt !== undefined &&
      (typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt)))) {
    throw new TypeError("Operation mode updatedAt is invalid");
  }
  return Object.freeze({
    mode: record.mode,
    version: record.version,
    ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
  });
};

const initialSnapshot: OperationModeSnapshot = Object.freeze({
  status: "loading",
  state: null,
  refreshing: false,
  stale: false,
});

export const createOperationModeController = (loader: OperationModeLoader): OperationModeController => {
  let snapshot = initialSnapshot;
  let inFlight: Promise<OperationModeSnapshot> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: OperationModeSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
    return snapshot;
  };

  const run = (preserveStableState: boolean) => {
    if (inFlight) return inFlight;
    if (preserveStableState && snapshot.state) {
      publish({ ...snapshot, refreshing: true });
    } else if (!snapshot.state) {
      publish({ status: "loading", state: null, refreshing: true, stale: false });
    }

    inFlight = Promise.resolve()
      .then(loader)
      .then(validateFrontendOperationModeState)
      .then((state) => publish({ status: "ready", state, refreshing: false, stale: false }))
      .catch(() => {
        if (snapshot.state) {
          return publish({
            status: "ready",
            state: snapshot.state,
            refreshing: false,
            stale: true,
          });
        }
        return publish({ status: "error", state: null, refreshing: false, stale: true });
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bootstrap: () => run(false),
    refresh: () => run(true),
  };
};
