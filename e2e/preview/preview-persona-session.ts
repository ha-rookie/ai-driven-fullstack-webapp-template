import { expect, type BrowserContext, type Page } from "@playwright/test";
import { WORKHUB_DEMO_PASSWORD } from "../../src/reference/workhub/personas";
import { submitPreviewLogin } from "./preview-login-evidence";

type Persona = "Aoi Employee" | "Kai Admin";
type Cookie = Awaited<ReturnType<BrowserContext["cookies"]>>[number];
interface CachedPreviewSession {
  readonly cookie: Cookie;
  readonly userId: string;
}

/**
 * Reuse one REAL authenticated Preview session per persona and Playwright worker.
 * Cookie stays only in worker memory: no storageState file, trace, artifact or log
 * of the token. Every test still uses its own isolated BrowserContext and the
 * server's normal signed-cookie / D1 session authorization path.
 *
 * This reduces repeated expensive Preview logins; it is NOT a fix for any
 * unattributed Cloudflare/edge 503. The standalone smoke suite deliberately
 * performs fresh sign-ins to keep actual login acceptance coverage.
 */
const sessions = new Map<Persona, CachedPreviewSession>();

const inspectSession = async (page: Page): Promise<{
  readonly status: number;
  readonly userId: string | null;
}> => {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", {
      method: "GET", credentials: "same-origin", cache: "no-store",
    });
    if (!response.ok) return { status: response.status, userId: null };
    const body = await response.json() as {
      authenticated?: boolean; user?: { id?: string };
    };
    return {
      status: response.status,
      userId: body.authenticated === true && typeof body.user?.id === "string"
        ? body.user.id : null,
    };
  });
};

export const loginPreviewPersona = async (page: Page, persona: Persona): Promise<void> => {
  const cached = sessions.get(persona);
  // The cache holds only a previously issued session, never a privileged test backdoor.
  if (cached && (cached.cookie.expires < 0 || cached.cookie.expires > Date.now() / 1_000 + 60)) {
    await page.context().addCookies([cached.cookie]);
    await page.goto("/", { waitUntil: "networkidle" });
    const checked = await inspectSession(page);
    if (checked.status === 200 && checked.userId === cached.userId) {
      console.log("Preview session reused", { persona, verified: true });
      return;
    }
    if (checked.status !== 401) {
      throw new Error("Preview cached session verification failed (" + checked.status + ")");
    }
    // An expired/revoked session may be refreshed through the REAL login UI.
    sessions.delete(persona);
    await page.context().clearCookies();
  } else {
    sessions.delete(persona);
    await page.goto("/", { waitUntil: "networkidle" });
  }

  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: new RegExp(persona, "u") }).click();
  await page.getByLabel("パスワード", { exact: true }).fill(WORKHUB_DEMO_PASSWORD);

  const loginResponse = await submitPreviewLogin(page, persona);
  expect(loginResponse.status(), "Preview login failed; inspect sanitized evidence").toBe(200);
  // submitPreviewLogin already verifies browser UI + /api/auth/me identity.
  // Do not re-consume the Playwright login Response body: the application
  // itself does not use that body, and Response.json() can hang indefinitely.
  const verifiedUserId = persona === "Aoi Employee" ? "workhub-demo-aoi" : "workhub-demo-kai";

  const cookies = await page.context().cookies();
  const cookie = cookies.find((entry) => entry.name === "app_session");
  expect(cookie, "Authenticated Preview login must set an HttpOnly app_session").toBeDefined();
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  // No token value is ever printed, written to disk or exposed in test assertions.
  if (cookie) {
    sessions.set(persona, { cookie, userId: verifiedUserId });
  }
};
