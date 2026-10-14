import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, user: "kai" | "aoi") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: user === "kai" ? /Kai Admin/u : /Aoi Employee/u })).toBeVisible();
};

test("#99 admin sees real scope members and looks up sessions without raw tokens", async ({ page }) => {
  await login(page, "kai");
  const membersRequest = page.waitForResponse(response =>
    response.url().includes("/api/admin/scopes/workhub-company/memberships")
    && response.request().method() === "GET");
  await page.goto("/admin");
  const members = await membersRequest;
  expect(members.status()).toBe(200);
  expect(members.headers()["cache-control"]).toContain("no-store");
  const payload = await members.json() as { scopeId: string; members: { userId: string; role: string; status: string }[]; limit: number; hasMore: boolean };
  expect(payload.scopeId).toBe("workhub-company");
  expect(payload.limit).toBe(50);
  expect(payload.members.length).toBeGreaterThan(0);
  expect(payload.members.length).toBeLessThanOrEqual(50);
  expect(JSON.stringify(payload)).not.toMatch(/tokenHash|sessionToken|password|providerSubject|email/i);

  const panel = page.locator("#admin-users-and-access");
  await expect(panel.getByRole("heading", { name: "ユーザー・権限管理" })).toBeVisible();
  await expect(panel.getByRole("table")).toBeVisible();
  await expect(page.locator("#admin-users-and-access").getByText("このScopeの所属ユーザーは見つかりませんでした。")).toHaveCount(0);
  const sessionRequest = page.waitForResponse(response =>
    response.url().includes("/api/admin/scopes/workhub-company/users/")
    && response.url().endsWith("/sessions") && response.request().method() === "GET");
  await panel.getByRole("button", { name: "有効セッションを確認" }).first().click();
  const sessions = await sessionRequest;
  expect(sessions.status()).toBe(200);
  const result = await sessions.json() as { sessions: { sessionId: string; lastSeenAt: string }[] };
  expect(Array.isArray(result.sessions)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/tokenHash|sessionToken|password/i);
  await expect(panel.getByRole("heading", { name: /有効セッション/u })).toBeVisible();
  await expect(panel.getByText("認証トークンやハッシュは取得・表示しません。", { exact: false })).toBeVisible();
});

test("#99 normal employee cannot mount Users & Access or enumerate scope members", async ({ page }) => {
  await login(page, "aoi");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "この領域を表示する権限がありません" })).toBeVisible();
  await expect(page.locator("#admin-users-and-access")).toHaveCount(0);
  const status = await page.evaluate(async () => (await fetch("/api/admin/scopes/workhub-company/memberships")).status);
  expect(status).toBe(403);
});

test("#99 inaccessible directory fails visibly without fabricating empty/healthy state", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/scopes/workhub-company/memberships", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "administration_unavailable" } }),
  }));
  await page.goto("/admin");
  const panel = page.locator("#admin-users-and-access");
  await expect(panel.getByRole("alert")).toContainText("所属ユーザーを取得できませんでした");
  await expect(panel.getByText("このScopeの所属ユーザーは見つかりませんでした。")).toHaveCount(0);
  await page.unroute("**/api/admin/scopes/workhub-company/memberships");
  await panel.getByRole("button", { name: "所属ユーザーを再取得" }).click();
  await expect(panel.getByRole("table")).toBeVisible();
});
