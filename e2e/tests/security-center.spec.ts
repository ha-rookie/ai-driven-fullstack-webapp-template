import { expect, test, type Page } from "@playwright/test";

/** Local browser validation, not Preview/Production or device System Test. */
const demoPassword = "Workhub-Demo-2026!";
const endpoint = "/api/admin/security-center?scopeId=workhub-company";
const login = async (page: Page, userId: string) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(userId);
  await page.getByLabel("パスワード", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: userId === "kai" ? /Kai Admin/u : /Aoi Employee/u })).toBeVisible();
};

test("#420 actual local administrator sees honest unknown coverage and SCS responsibility view", async ({ page }) => {
  await login(page, "kai");
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("heading", { name: "Security Center｜監査の現在地" })).toBeVisible();
  await expect(panel.getByTestId("security-coverage")).toContainText("確認済み0件ではありません");
  await expect(panel.getByText("シークレット検出", { exact: true })).toBeVisible();
  await expect(panel.getByText("依存関係監査", { exact: true })).toBeVisible();
  const mapping = panel.getByRole("table").nth(1);
  await expect(mapping.locator("tbody tr")).toHaveCount(43);
  await expect(panel.getByText(/SCS認定結果ではありません/u)).toBeVisible();
  await panel.getByLabel("SCS責務・状態で絞り込み").selectOption("Organization Responsibility");
  expect(await mapping.locator("tbody tr").count()).toBeGreaterThan(0);
  await expect(panel.getByRole("link", { name: /既存の監査ログを確認/u }))
    .toHaveAttribute("href", "#admin-audit-and-security");

  // The in-page fetch uses the same authenticated browser session as the UI.
  // Playwright's standalone APIRequestContext does not reproduce this app's login context.
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    return { status: response.status, cacheControl: response.headers.get("cache-control"),
      body: await response.json() as { findings: { verifiedCount: unknown }; sources: unknown[] } };
  }, endpoint);
  expect(result.status).toBe(200);
  expect(result.cacheControl).toBe("no-store");
  expect(result.body.findings.verifiedCount).toBeNull();
  expect(result.body.sources).toHaveLength(4);
});

test("#420 real route denies anonymous, wrong-scope and unsupported method", async ({ request }) => {
  const anon = await request.get(endpoint);
  expect(anon.status()).toBe(401);
  const other = await request.get("/api/admin/security-center?scopeId=another-scope");
  expect(other.status()).toBe(403);
  const duplicate = await request.get(endpoint + "&scopeId=workhub-company");
  expect(duplicate.status()).toBe(400);
  const post = await request.post(endpoint);
  expect(post.status()).toBe(405);
});

test("#420 logged-in non-admin cannot see privileged Security Center API data", async ({ page }) => {
  await login(page, "aoi");
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    return { status: response.status, body: await response.text() };
  }, endpoint);
  expect(result.status).toBe(403);
  expect(result.body).not.toContain("sourceKind");
  expect(result.body).not.toContain("checkedFindingCount");
});
