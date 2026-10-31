import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type PropsWithChildren,
} from "react";
import { useAuth } from "../auth";
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

export interface UserPreferencesContextValue {
  readonly resolved: ResolvedUserPreferences;
  /** Values in a pending draft are not persistent until the server confirms PATCH. */
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

/** One server GET per authenticated shell/refresh, never per consumer component. */
export const UserPreferencesProvider = ({ children }: PropsWithChildren) => {
  const auth = useAuth();
  const [device, setDevice] = useState(readWorkhubDeviceSignals);
  const [previewState, setPreviewState] = useState<WorkhubPreferencePreview | null>(null);
  const [serverState, setServerState] = useState<{
    userId: string; version: number; values: UserPreferenceValues;
  } | null>(null);
  const [loadState, setLoadState] = useState<{ userId: string; status: LoadStatus } | null>(null);
  const [saveState, setSaveState] = useState<{ userId: string; status: SaveStatus } | null>(null);
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
  const currentPreview = userId !== null && previewState?.userId === userId ? previewState : null;
  const currentServer = userId !== null && serverState?.userId === userId ? serverState : null;
  const loadStatus: LoadStatus = userId !== null && loadState?.userId === userId ? loadState.status : "loading";
  const saveStatus: SaveStatus = userId !== null && saveState?.userId === userId ? saveState.status : "idle";

  useEffect(() => {
    if (userId === null) {
      setServerState(null);
      setLoadState(null);
      setSaveState(null);
      return;
    }
    let active = true;
    setLoadState({ userId, status: "loading" });
    setSaveState({ userId, status: "idle" });
    void fetch("/api/me/preferences", {
      method: "GET", credentials: "same-origin", cache: "no-store",
      headers: { accept: "application/json" },
    }).then(async response => {
      if (!response.ok) throw new Error("Preference read unavailable");
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object") throw new Error("Invalid preference response");
      const record = payload as { schemaVersion?: unknown; version?: unknown; values?: unknown };
      if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.version) ||
          (record.version as number) < 0) throw new Error("Invalid preference version");
      const values = validateUserPreferencePatch(record.values, workhubUserPreferencePolicy);
      if (active && activeUserRef.current === userId) {
        setServerState({ userId, version: record.version as number, values });
        setLoadState({ userId, status: "ready" });
      }
    }).catch(() => {
      if (active && activeUserRef.current === userId) setLoadState({ userId, status: "error" });
    });
    return () => { active = false; };
  }, [userId, reloadKey]);

  useEffect(() => { setPreviewState(null); }, [userId]);

  const setPreview = useCallback((field: PreferenceField, input: string | null) => {
    if (userId === null) return;
    const validated = validateUserPreferencePatch({ [field]: input }, workhubUserPreferencePolicy);
    setPreviewState(previous => ({
      userId,
      values: {
        ...(previous?.userId === userId ? previous.values :
          serverState?.userId === userId ? serverState.values : {}),
        ...validated,
      },
    }));
    setSaveState({ userId, status: "idle" });
  }, [userId, serverState]);

  const resetPreview = useCallback(() => {
    setPreviewState(null);
    if (userId) setSaveState({ userId, status: "idle" });
  }, [userId]);
  const reloadSaved = useCallback(() => {
    setPreviewState(null);
    setReloadKey(previous => previous + 1);
  }, []);

  const savePreview = useCallback(async () => {
    if (userId === null || !currentPreview || !currentServer || loadStatus !== "ready" ||
        saveStatus === "saving") return;
    const id = userId;
    setSaveState({ userId: id, status: "saving" });
    try {
      const csrf = await fetch("/api/auth/csrf", {
        method: "GET", credentials: "same-origin", cache: "no-store",
      });
      if (!csrf.ok) throw new Error("CSRF unavailable");
      const csrfBody = await csrf.json() as { csrfToken?: string };
      if (!csrfBody.csrfToken) throw new Error("CSRF unavailable");
      const response = await fetch("/api/me/preferences", {
        method: "PATCH", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrfBody.csrfToken },
        body: JSON.stringify({ expectedVersion: currentServer.version, patch: currentPreview.values }),
      });
      if (response.status === 409) {
        if (activeUserRef.current === id) setSaveState({ userId: id, status: "conflict" });
        return;
      }
      if (!response.ok) throw new Error("Preference save unavailable");
      const payload = await response.json() as { version: number; values: UserPreferenceValues };
      if (!Number.isSafeInteger(payload.version) || !payload.values) throw new Error("Invalid preference response");
      const values = validateUserPreferencePatch(payload.values, workhubUserPreferencePolicy);
      if (activeUserRef.current === id) {
        setServerState({ userId: id, version: payload.version, values });
        setPreviewState(null);
        setSaveState({ userId: id, status: "saved" });
      }
    } catch {
      if (activeUserRef.current === id) setSaveState({ userId: id, status: "error" });
    }
  }, [userId, currentPreview, currentServer, loadStatus, saveStatus]);

  const value = useMemo<UserPreferencesContextValue>(() => ({
    resolved: resolveWorkhubPreferencePreview(
      userId, currentPreview ?? (loadStatus === "ready" && currentServer
        ? { userId: currentServer.userId, values: currentServer.values } : null), device,
    ),
    sourceOfTruth: currentPreview ? "unsaved-session-preview"
      : loadStatus === "ready" && currentServer ? "server-saved-user-preferences"
      : "device-and-project-defaults-only",
    authenticated,
    preview: currentPreview?.values ?? (loadStatus === "ready" ? currentServer?.values ?? {} : {}),
    previewActive: currentPreview !== null,
    loadStatus, saveStatus, savePreview, reloadSaved, setPreview, resetPreview,
  }), [userId, currentPreview, currentServer, device, authenticated, loadStatus, saveStatus,
    savePreview, reloadSaved, setPreview, resetPreview]);

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
};

export const useUserPreferences = (): UserPreferencesContextValue => {
  const value = useContext(UserPreferencesContext);
  if (value === null) throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  return value;
};
