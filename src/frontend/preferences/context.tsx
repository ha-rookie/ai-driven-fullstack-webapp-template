import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { useAuth } from "../auth";
import { ApiClientError } from "../api";
import { createMutationState, runSafeMutation, type MutationStateController } from "../mutation";
import {
  resolveUserPreferences, validateUserPreferencePatch, workhubUserPreferencePolicy,
  type PreferenceDeviceSignals, type PreferenceField, type UserPreferenceValues,
  type ResolvedUserPreferences,
} from "../../shared/user-preferences";

const deviceLocale = (): string | undefined => {
  if (typeof navigator === "undefined") return undefined;
  const browserLanguages = [...(navigator.languages ?? []), navigator.language];
  for (const language of browserLanguages) {
    if (/^ja(?:-|$)/i.test(language)) return "ja-JP";
    if (/^en(?:-|$)/i.test(language)) return "en-US";
  }
  return undefined;
};

export const readWorkhubDeviceSignals = (): PreferenceDeviceSignals => {
  let timezone: string | undefined;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; }
  catch { /* Optional OS signal. */ }
  let prefersDark: boolean | undefined;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try { prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches; }
    catch { /* Optional OS signal. */ }
  }
  return { locale: deviceLocale(), timezone, prefersDark };
};

export interface WorkhubPreferencePreview {
  readonly userId: string;
  readonly values: UserPreferenceValues;
}

export const resolveWorkhubPreferencePreview = (
  authenticatedUserId: string | null,
  preview: WorkhubPreferencePreview | null,
  device: PreferenceDeviceSignals,
): ResolvedUserPreferences => resolveUserPreferences({
  policy: workhubUserPreferencePolicy,
  authenticated: authenticatedUserId !== null,
  user: authenticatedUserId !== null && preview?.userId === authenticatedUserId ? preview.values : null,
  device,
});

type LoadStatus = "loading" | "ready" | "error";
type SaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

interface SavedPreferences {
  readonly version: number;
  readonly values: UserPreferenceValues;
}

/** Reuse #155's shared clean/dirty/submitting/conflict/failed state and version gate. */
export const createWorkhubPreferenceMutation = (
  persisted: SavedPreferences,
): MutationStateController<SavedPreferences> => createMutationState(persisted, {
  normalize: entry => JSON.stringify([
    entry.values.locale ?? null, entry.values.timezone ?? null, entry.values.theme ?? null,
  ]),
  expectedVersion: entry => entry.version,
});

const fetchSavedPreferences = async (): Promise<SavedPreferences> => {
  const response = await fetch("/api/me/preferences", {
    method: "GET", credentials: "same-origin", cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Preference read unavailable");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("Invalid preference response");
  const record = payload as { schemaVersion?: unknown; version?: unknown; values?: unknown };
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.version) ||
      (record.version as number) < 0) throw new Error("Invalid preference version");
  return {
    version: record.version as number,
    values: validateUserPreferencePatch(record.values, workhubUserPreferencePolicy),
  };
};

export interface UserPreferencesContextValue {
  readonly resolved: ResolvedUserPreferences;
  /** Drafts are never the persisted source of truth until PATCH succeeds. */
  readonly sourceOfTruth: "device-and-project-defaults-only" | "unsaved-session-preview" | "server-saved-user-preferences";
  readonly authenticated: boolean;
  readonly preview: UserPreferenceValues;
  readonly previewActive: boolean;
  readonly loadStatus: LoadStatus;
  readonly saveStatus: SaveStatus;
  readonly setPreview: (field: PreferenceField, value: string | null) => void;
  readonly resetPreview: () => void;
  readonly savePreview: () => Promise<void>;
  readonly reloadSaved: () => void;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

/** #60: one GET per authenticated shell, shared by all consumers; no localStorage. */
export const UserPreferencesProvider = ({ children }: PropsWithChildren) => {
  const auth = useAuth(); // #126: consume authenticated identity, never store raw tokens.
  const [device, setDevice] = useState(readWorkhubDeviceSignals);
  const [controllerState, setControllerState] = useState<{
    userId: string; controller: MutationStateController<SavedPreferences>;
  } | null>(null);
  const [loadState, setLoadState] = useState<{ userId: string; status: LoadStatus } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => setDevice(readWorkhubDeviceSignals());
    const media = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    window.addEventListener("languagechange", refresh);
    media?.addEventListener?.("change", refresh);
    return () => {
      window.removeEventListener("languagechange", refresh);
      media?.removeEventListener?.("change", refresh);
    };
  }, []);

  const userId = auth.status === "authenticated" ? auth.user?.id ?? null : null;
  const authenticated = userId !== null;
  const activeUserRef = useRef(userId);
  activeUserRef.current = userId;

  // Both the identity gate and subscription are shared across consumers (#126/#155).
  const currentController = userId !== null && controllerState?.userId === userId
    ? controllerState.controller : null;
  const subscribe = useCallback((listener: () => void) =>
    currentController?.subscribe(listener) ?? (() => {}), [currentController]);
  const getSnapshot = useCallback(() => currentController?.getSnapshot() ?? null, [currentController]);
  const mutation = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const loadStatus: LoadStatus = userId !== null && loadState?.userId === userId
    ? loadState.status : "loading";
  const phase = mutation?.phase;
  const previewActive = phase === "dirty" || phase === "submitting" ||
    phase === "conflict" || phase === "failed";
  const saveStatus: SaveStatus = phase === "submitting" ? "saving"
    : phase === "success" ? "saved"
      : phase === "conflict" ? "conflict"
        : phase === "failed" ? "error" : "idle";

  useEffect(() => {
    if (userId === null) {
      setControllerState(null);
      setLoadState(null);
      return;
    }
    let active = true;
    setControllerState(null);
    setLoadState({ userId, status: "loading" });
    void fetchSavedPreferences().then(saved => {
      if (active && activeUserRef.current === userId) {
        setControllerState({ userId, controller: createWorkhubPreferenceMutation(saved) });
        setLoadState({ userId, status: "ready" });
      }
    }).catch(() => {
      if (active && activeUserRef.current === userId) setLoadState({ userId, status: "error" });
    });
    return () => { active = false; };
  }, [userId, reloadKey]);

  const setPreview = useCallback((field: PreferenceField, input: string | null) => {
    if (!currentController || !mutation || loadStatus !== "ready") return;
    const validated = validateUserPreferencePatch({ [field]: input }, workhubUserPreferencePolicy);
    currentController.setDraft({
      version: mutation.persisted.version,
      values: { ...mutation.draft.values, ...validated },
    });
  }, [currentController, mutation, loadStatus]);

  const resetPreview = useCallback(() => {
    if (currentController && mutation && phase !== "submitting") {
      currentController.acceptLatest(mutation.persisted);
    }
  }, [currentController, mutation, phase]);

  const reloadSaved = useCallback(() => {
    setControllerState(null);
    setReloadKey(previous => previous + 1);
  }, []);

  const savePreview = useCallback(async () => {
    if (!currentController || !mutation || userId === null || loadStatus !== "ready") return;
    const submittingUserId = userId;
    await runSafeMutation(currentController, async ({ draft, expectedVersion }) => {
      const csrf = await fetch("/api/auth/csrf", {
        method: "GET", credentials: "same-origin", cache: "no-store",
      });
      if (!csrf.ok) throw new Error("CSRF unavailable");
      const csrfBody = await csrf.json() as { csrfToken?: string };
      if (!csrfBody.csrfToken) throw new Error("CSRF unavailable");
      const response = await fetch("/api/me/preferences", {
        method: "PATCH", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrfBody.csrfToken },
        body: JSON.stringify({ expectedVersion, patch: draft.values }),
      });
      if (response.status === 409) {
        throw new ApiClientError("http", "Preference conflict", { status: 409 });
      }
      if (response.status === 401) {
        throw new ApiClientError("http", "Authentication required", { status: 401 });
      }
      if (!response.ok) throw new Error("Preference save unavailable");
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object") throw new Error("Invalid preference response");
      const record = payload as { version?: unknown; values?: unknown };
      if (!Number.isSafeInteger(record.version) || (record.version as number) < 1) {
        throw new Error("Invalid preference response");
      }
      return {
        version: record.version as number,
        values: validateUserPreferencePatch(record.values, workhubUserPreferencePolicy),
      };
    }, {
      loadLatest: fetchSavedPreferences, // #155: refresh latest without discarding a conflicting draft.
      onAuthenticationRequired: async () => {
        if (activeUserRef.current === submittingUserId) await auth.synchronize();
      },
    });
  }, [currentController, mutation, userId, loadStatus, auth]);

  const resolvedCandidate: WorkhubPreferencePreview | null = userId !== null && mutation
    ? { userId, values: (previewActive ? mutation.draft : mutation.persisted).values } : null;
  const value = useMemo<UserPreferencesContextValue>(() => ({
    resolved: resolveWorkhubPreferencePreview(userId, resolvedCandidate, device),
    sourceOfTruth: previewActive ? "unsaved-session-preview"
      : loadStatus === "ready" && mutation ? "server-saved-user-preferences"
        : "device-and-project-defaults-only",
    authenticated,
    preview: mutation?.draft.values ?? {},
    previewActive,
    loadStatus, saveStatus, savePreview, reloadSaved, setPreview, resetPreview,
  }), [userId, resolvedCandidate, device, previewActive, loadStatus, mutation, authenticated,
    saveStatus, savePreview, reloadSaved, setPreview, resetPreview]);

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
};

export const useUserPreferences = (): UserPreferencesContextValue => {
  const value = useContext(UserPreferencesContext);
  if (value === null) throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  return value;
};
