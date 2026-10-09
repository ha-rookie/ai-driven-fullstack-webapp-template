import { expect, type Page, type Response } from "@playwright/test";
import { ensurePreviewLoginResponseComplete } from "./preview-response-completion";

/**
 * Preview acceptance tests must distinguish an application's deliberate 503
 * (which has x-request-id and Preview auth dependency evidence) from a
 * response that cannot be attributed to the application.
 *
 * Retry only the latter, at most twice. Never retry 401, 403, 429, or
 * authenticated application 503: those are security or dependency findings.
 * Do not log credentials, cookies or arbitrary HTML response bodies.
 */
export const submitPreviewLogin = async (
  page: Page,
  persona: "Aoi Employee" | "Kai Admin",
): Promise<Response> => {
  const delaysMs = [650, 1450];
  let lastResponse: Response | null = null;
  for (let attempt = 1; attempt <= delaysMs.length + 1; attempt += 1) {
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login")
      && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    const response = await responsePromise;
    lastResponse = response;
    const headers = response.headers();
    const requestId = headers["x-request-id"] ?? null;
    const dependencyStage = headers["x-auth-dependency-stage"] ?? null;
    const unattributed503 = response.status() === 503 && !requestId && !dependencyStage;

    console.log("Preview login attempt evidence", {
      persona, attempt, status: response.status(), requestId, dependencyStage,
      dependencyDetail: headers["x-auth-dependency-detail"] ?? null,
      cfRay: headers["cf-ray"] ?? null, retryAfter: headers["retry-after"] ?? null,
      unattributed503,
    });

    if (response.status() === 200) {
      // An HTTP 200 with a never-ending body is NOT a successful login.
      // Distinguish it from the retryable unattributed 503, without logging
      // response bodies, credentials, cookies or tokens.
      await ensurePreviewLoginResponseComplete(response);
      return response;
    }
    if (!unattributed503 || attempt > delaysMs.length) return response;

    // The UI keeps the password in its controlled form after an unsuccessful
    // request; no credentials or session state are bypassed to retry.
    await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeEnabled();
    await page.waitForTimeout(delaysMs[attempt - 1]);
  }
  if (!lastResponse) throw new Error("Preview login produced no response");
  return lastResponse;
};
