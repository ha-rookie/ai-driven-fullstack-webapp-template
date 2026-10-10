import { useState } from "react";
import "./account-switch.css";

/**
 * Switching Demo Personas is a real logout, never a client-only impersonation.
 * Revoke the server-side session first, then reload the regular sign-in screen.
 * Shared by employee and administration portals.
 */
export default function AccountSwitchButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchAccount = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const csrfResponse = await fetch("/api/auth/csrf", {
        method: "GET", credentials: "same-origin", cache: "no-store",
      });
      if (!csrfResponse.ok) throw new Error("csrf_unavailable");
      const { csrfToken } = await csrfResponse.json() as { csrfToken?: unknown };
      if (typeof csrfToken !== "string" || !csrfToken) throw new Error("csrf_invalid");

      const logoutResponse = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken, accept: "application/json" },
      });
      if (logoutResponse.status !== 204) throw new Error("logout_unavailable");

      // No password is saved. Clear the convenience user-id so next Persona
      // selection is not confused with the account that has just signed out.
      try { localStorage.removeItem("workhub.rememberedUserId"); }
      catch { /* private browser storage can be unavailable */ }
      window.location.replace("/");
    } catch {
      // Do not claim logout or change accounts if the server did not revoke it.
      setError("ログアウトできませんでした。通信状態を確認して再度お試しください。");
      setBusy(false);
    }
  };

  return <div className="workhub-account-switch">
    <button type="button" className="workhub-account-switch-button"
      onClick={() => void switchAccount()} disabled={busy}
      aria-label="ログアウトして別のユーザーでログイン">
      {busy ? "切替中…" : "ユーザー切替"}
    </button>
    {error && <p className="workhub-account-switch-error" role="alert">{error}</p>}
  </div>;
}
