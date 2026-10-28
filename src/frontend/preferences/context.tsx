import {
  createContext,
  useCallback,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "../auth";
import {
  resolveUserPreferences,
  validateUserPreferencePatch,
  type PreferenceDeviceSignals,
  type PreferenceField,
  type UserPreferenceValues,
  type ResolvedUserPreferences,
  type UserPreferencePolicy,
} from "../../shared/user-preferences";

// WORKHUB reference policy only. The generic resolver does not fix project values.
const workhubPreferencePolicy: UserPreferencePolicy = {
  locale: { allowed: ["ja-JP", "en-US"], projectDefault: "ja-JP", systemDefault: "ja-JP" },
  timezone: {
    allowed: ["Asia/Tokyo", "UTC", "America/New_York"],
    projectDefault: "Asia/Tokyo",
    systemDefault: "UTC",
  },
  theme: {
    allowed: ["light", "dark", "system"],
    projectDefault: "system",
    systemDefault: "light",
  },
};

const deviceLocale = (): string | undefined => {
  if (typeof navigator === "undefined") return undefined;
  // Language mapping is a project decision; do not add unsupported locales.
  const browserLanguages = [...(navigator.languages ?? []), navigator.language];
  for (const language of browserLanguages) {
    if (/^ja(?:-|$)/i.test(language)) return "ja-JP";
    if (/^en(?:-|$)/i.test(language)) return "en-US";
  }
  return undefined;
};

export const readWorkhubDeviceSignals = (): PreferenceDeviceSignals => {
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    // Browser/OS signals are optional; the resolver has explicit project defaults.
  }
  let prefersDark: boolean | undefined;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      // Unsupported media query must not prevent rendering or cause a logout.
    }
  }
  return { locale: deviceLocale(), timezone, prefersDark };
};

export interface WorkhubPreferencePreview {
  readonly userId: string;
  readonly values: UserPreferenceValues;
}

/**
 * Reuse the shared resolver for an explicitly unsaved, current-user-only preview.
 * Never present preview values for a different user or an unauthenticated session.
 */
export const resolveWorkhubPreferencePreview = (
  authenticatedUserId: string | null,
  preview: WorkhubPreferencePreview | null,
  device: PreferenceDeviceSignals,
): ResolvedUserPreferences => resolveUserPreferences({
  policy: workhubPreferencePolicy,
  authenticated: authenticatedUserId !== null,
  user: authenticatedUserId !== null && preview?.userId === authenticatedUserId ? preview.values : null,
  device,
});

export interface UserPreferencesContextValue {
  readonly resolved: ResolvedUserPreferences;
  /** "user" provenance inside a preview means a simulated user-layer value, NEVER persisted. */
  readonly sourceOfTruth: "device-and-project-defaults-only" | "unsaved-session-preview";
  readonly authenticated: boolean;
  readonly preview: UserPreferenceValues;
  readonly previewActive: boolean;
  readonly setPreview: (field: PreferenceField, value: string | null) => void;
  readonly resetPreview: () => void;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

/**
 * One shared resolution per WORKHUB shell, without storage, remote calls or a
 * fake saved-user preference. Auth status is trusted; browser hints are not.
 */
export const UserPreferencesProvider = ({ children }: PropsWithChildren) => {
  const auth = useAuth();
  const [device, setDevice] = useState(readWorkhubDeviceSignals);
  // Transient in-memory settings for demo only. No localStorage, API or saved-user profile.
  const [previewState, setPreviewState] = useState<WorkhubPreferencePreview | null>(null);

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
  const currentPreview = userId !== null && previewState?.userId === userId ? previewState : null;

  // Identity changes must clear the old simulation; the render gate above also
  // prevents even one frame of another account's preview before this effect runs.
  useEffect(() => { setPreviewState(null); }, [userId]);

  const setPreview = useCallback((field: PreferenceField, input: string | null) => {
    if (userId === null) return;
    const validated = validateUserPreferencePatch({ [field]: input }, workhubPreferencePolicy);
    setPreviewState(previous => ({
      userId,
      values: { ...(previous?.userId === userId ? previous.values : {}), ...validated },
    }));
  }, [userId]);
  const resetPreview = useCallback(() => setPreviewState(null), []);

  const value = useMemo<UserPreferencesContextValue>(() => ({
    resolved: resolveWorkhubPreferencePreview(userId, currentPreview, device),
    sourceOfTruth: currentPreview ? "unsaved-session-preview" : "device-and-project-defaults-only",
    authenticated,
    preview: currentPreview?.values ?? {},
    previewActive: currentPreview !== null,
    setPreview,
    resetPreview,
  }), [userId, currentPreview, device, authenticated, setPreview, resetPreview]);

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
};

export const useUserPreferences = (): UserPreferencesContextValue => {
  const value = useContext(UserPreferencesContext);
  if (value === null) {
    throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  }
  return value;
};
