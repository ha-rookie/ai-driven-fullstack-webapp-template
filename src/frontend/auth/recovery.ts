import { ApiClientError } from "../api";
import type { AuthSnapshot } from "./state";

export type RuntimeReauthStatus = "idle" | "recovering" | "recovered" | "failed";

export interface RuntimeReauthSnapshot {
  readonly status: RuntimeReauthStatus;
  readonly attempt: number;
  readonly requestId?: string;
}

export interface RuntimeReauthController {
  getSnapshot(): RuntimeReauthSnapshot;
  subscribe(listener: () => void): () => void;
  handle(error: unknown): Promise<boolean>;
  retry(): Promise<RuntimeReauthSnapshot>;
  acknowledge(): void;
  resetAfterLogout(): void;
}

export interface RuntimeReauthOptions {
  readonly beginReauthentication: () => void | Promise<void>;
  readonly synchronize: () => Promise<AuthSnapshot>;
}

const isRuntimeAuthenticationFailure = (error: unknown): error is ApiClientError =>
  error instanceof ApiClientError && error.kind === "http" && error.status === 401;

const safeRequestId = (error: ApiClientError) => {
  const value = error.requestId?.trim();
  return value && value.length <= 128 ? value : undefined;
};

export const createRuntimeReauthController = (
  options: RuntimeReauthOptions,
): RuntimeReauthController => {
  let snapshot: RuntimeReauthSnapshot = Object.freeze({ status: "idle", attempt: 0 });
  let inFlight: Promise<RuntimeReauthSnapshot> | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();

  const publish = (next: RuntimeReauthSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
    return snapshot;
  };

  const run = () => {
    if (inFlight) return inFlight;
    const runGeneration = generation;
    const attempt = snapshot.attempt + 1;
    const requestId = snapshot.requestId;
    publish({
      status: "recovering",
      attempt,
      ...(requestId ? { requestId } : {}),
    });

    inFlight = Promise.resolve()
      .then(() => options.beginReauthentication())
      .then(() => options.synchronize())
      .then((auth) => {
        if (runGeneration !== generation) return snapshot;
        if (auth.status !== "authenticated") {
          return publish({
            status: "failed",
            attempt,
            ...(requestId ? { requestId } : {}),
          });
        }
        return publish({
          status: "recovered",
          attempt,
          ...(requestId ? { requestId } : {}),
        });
      })
      .catch(() => {
        if (runGeneration !== generation) return snapshot;
        return publish({
          status: "failed",
          attempt,
          ...(requestId ? { requestId } : {}),
        });
      })
      .finally(() => {
        if (runGeneration === generation) inFlight = null;
      });

    return inFlight;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async handle(error) {
      if (!isRuntimeAuthenticationFailure(error)) return false;
      if (!inFlight) {
        const requestId = safeRequestId(error);
        publish({
          status: "idle",
          attempt: snapshot.attempt,
          ...(requestId ? { requestId } : {}),
        });
      }
      await run();
      return true;
    },
    retry() {
      if (snapshot.status !== "failed") return Promise.resolve(snapshot);
      return run();
    },
    acknowledge() {
      if (snapshot.status === "recovering") return;
      publish({ status: "idle", attempt: snapshot.attempt });
    },
    resetAfterLogout() {
      generation += 1;
      inFlight = null;
      publish({ status: "idle", attempt: 0 });
    },
  };
};
