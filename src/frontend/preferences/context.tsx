import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "../auth";
import {
  resolveUserPreferences,
  type PreferenceDeviceSignals,
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

export interface UserPreferencesContextValue {
  readonly resolved: ResolvedUserPreferences;
  /** This slice has NO authenticated server-side preference loader or saved values. */
  readonly sourceOfTruth: "device-and-project-defaults-only";
  readonly authenticated: boolean;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

/**
 * One shared resolution per WORKHUB shell, without storage, remote calls or a
 * fake saved-user preference. Auth status is trusted; browser hints are not.
 */
export const UserPreferencesProvider = ({ children }: PropsWithChildren) => {
  const auth = useAuth();
  const [device, setDevice] = useState(readWorkhubDeviceSignals);

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

  const authenticated = auth.status === "authenticated" && auth.user !== null;
  const value = useMemo<UserPreferencesContextValue>(() => ({
    resolved: resolveUserPreferences({
      policy: workhubPreferencePolicy,
      authenticated,
      device,
      // Do not synthesize persisted preferences from user ID or browser storage.
    }),
    sourceOfTruth: "device-and-project-defaults-only",
    authenticated,
  }), [authenticated, device]);

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
};

export const useUserPreferences = (): UserPreferencesContextValue => {
  const value = useContext(UserPreferencesContext);
  if (value === null) {
    throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  }
  return value;
};
