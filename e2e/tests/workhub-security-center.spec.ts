import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, user: "kai" | "aoi") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", {
    name: user === "kai" ? /Kai Admin/u : /Aoi Employee/u,
  })).toBeVisible();
};

test("#420 admin sees read-only Security Center without fabricated green or zero", async ({ page }) => {
  await login(page, "kai");
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("heading", { name: "セキュリティ確認センター" })).toBeVisible();
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
  await expect(panel.getByText("検査ソース未接続／Finding件数は不明", { exact: false })).toBeVisible();
  await expect(panel.getByText("43 要件", { exact: false })).toBeVisible();
  await panel.getByLabel("要件・責任を検索").fill("3-1-1");
  await expect(panel.getByText("3-1-1", { exact: true })).toBeVisible();
  await expect(panel.getByText("表示 1 / 43 要件")).toBeVisible();
  const check = await page.evaluate(async () => {
    const url = "/api/admin/security/center?scopeId=workhub-company";
    const response = await fetch(url);
    const body = await response.json() as { findings: { verifiedCount: number | null }; scs: { certification: string } };
    return { status: response.status, cache: response.headers.get("cache-control"),
      count: body.findings.verifiedCount, certification: body.scs.certification,
      post: (await fetch(url, { method: "POST" })).status,
      wrongScope: (await fetch("/api/admin/security/center?scopeId=other")).status };
  });
  expect(check.status).toBe(200);
  expect(check.cache).toContain("no-store");
  expect(check.count).toBeNull();
  expect(check.certification).toBe("not-assessed");
  expect(check.post).toBe(405);
  expect(check.wrongScope).toBe(400);
});

test("#420 ordinary employee cannot view Security Center or read its API", async ({ page }) => {
  await login(page, "aoi");
  await page.goto("/admin");
  await expect(page.locator("#admin-security-center")).toHaveCount(0);
  const status = await page.evaluate(async () =>
    (await fetch("/api/admin/security/center?scopeId=workhub-company")).status);
  expect(status).toBe(403);
});

test("#420 failed source never renders safe or empty status", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: '{"error":{"code":"security_center_unavailable"}}',
  }));
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("alert")).toContainText("状態を取得できませんでした");
  await expect(panel.getByTestId("security-center-posture")).toHaveCount(0);
});
