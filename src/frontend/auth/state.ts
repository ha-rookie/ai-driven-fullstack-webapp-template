import type { FetchLike } from "../api";

export interface AuthUser {
  readonly id: string;
  readonly displayName: string | null;
}

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export interface AuthSnapshot {
  readonly status: AuthStatus;
  readonly user: AuthUser | null;
  readonly syncing: boolean;
  readonly requestId?: string;
}

export interface AuthController {
  getSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): () => void;
  bootstrap(): Promise<AuthSnapshot>;
  synchronize(): Promise<AuthSnapshot>;
  resetAfterLogout(): void;
}

export type AuthLoader = () => Promise<AuthUser>;

class AuthLoadError extends Error {
  readonly kind: "unauthenticated" | "unavailable" | "protocol";
  readonly requestId?: string;

  constructor(kind: AuthLoadError["kind"], requestId?: string) {
    super(kind === "unauthenticated" ? "Authentication required" : "Authentication state unavailable");
    this.name = "AuthLoadError";
    this.kind = kind;
    this.requestId = requestId;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

const readRequestId = (response: Response) => {
  const requestId = response.headers.get("x-request-id")?.trim();
  return requestId && requestId.length <= 128 ? requestId : undefined;
};

export const decodeAuthMePayload = (value: unknown): AuthUser | null => {
  if (!isRecord(value) || value.authenticated !== true || !isRecord(value.user)) return null;
  if (!boundedString(value.user.id, 256)) return null;
  const displayName = value.user.displayName;
  if (displayName !== null && displayName !== undefined && (typeof displayName !== "string" || displayName.length > 500)) {
    return null;
  }
  return { id: value.user.id, displayName: displayName ?? null };
};

export const createAuthApiLoader = (
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): AuthLoader => async () => {
  let response: Response;
  try {
    response = await fetchImpl("/api/auth/me", {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
    });
  } catch {
    throw new AuthLoadError("unavailable");
  }

  const requestId = readRequestId(response);
  if (response.status === 401) throw new AuthLoadError("unauthenticated", requestId);
  if (!response.ok) throw new AuthLoadError("unavailable", requestId);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && !contentType?.endsWith("+json")) {
    throw new AuthLoadError("protocol", requestId);
  }

  const text = await response.text();
  if (text.length === 0 || text.length > 65_536) throw new AuthLoadError("protocol", requestId);
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new AuthLoadError("protocol", requestId);
  }
  const user = decodeAuthMePayload(payload);
  if (!user) throw new AuthLoadError("protocol", requestId);
  return user;
};

const initialSnapshot: AuthSnapshot = Object.freeze({
  status: "loading",
  user: null,
  syncing: false,
});

export const createAuthController = (loader: AuthLoader): AuthController => {
  let snapshot = initialSnapshot;
  let inFlight: Promise<AuthSnapshot> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: AuthSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
    return snapshot;
  };

  const run = (preserveStableState: boolean) => {
    if (inFlight) return inFlight;
    if (preserveStableState && snapshot.status !== "loading") {
      publish({ ...snapshot, syncing: true });
    }

    inFlight = loader()
      .then((user) => publish({ status: "authenticated", user, syncing: false }))
      .catch((error: unknown) => {
        if (error instanceof AuthLoadError && error.kind === "unauthenticated") {
          return publish({
            status: "unauthenticated",
            user: null,
            syncing: false,
            ...(error.requestId ? { requestId: error.requestId } : {}),
          });
        }
        return publish({
          status: "error",
          user: null,
          syncing: false,
          ...(error instanceof AuthLoadError && error.requestId ? { requestId: error.requestId } : {}),
        });
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
    synchronize: () => run(true),
    resetAfterLogout() {
      inFlight = null;
      publish({ status: "unauthenticated", user: null, syncing: false });
    },
  };
};
