import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, userId: "aoi" | "ren") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(userId);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます/u })).toBeVisible();
};

test("Stage4 social reference is scoped, not an official announcement, and safely recovers on 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const anonymous = await page.request.get("/api/workhub/social");
  expect(anonymous.status()).toBe(401);
  await login(page, "aoi");
  const social = page.getByRole("region", { name: "社内交流フィード" });
  const homePreview = page.getByRole("region", { name: "社内交流プレビュー" });
  await expect(homePreview.getByRole("article")).toHaveCount(2);
  await expect(homePreview).toContainText("参考投稿");
  await expect(homePreview).not.toContainText("マネージャー向け交流会");
  await homePreview.getByRole("link", { name: "社内交流フィードを見る" }).click();
  await expect(social).toBeInViewport();
  await expect(social.getByRole("article")).toHaveCount(3);
  await expect(social).toContainText("公式のお知らせや規程ではありません");
  await expect(social).not.toContainText("マネージャー向け交流会");
  const employeeApi = await page.evaluate(async () => {
    const r = await fetch("/api/workhub/social", { credentials: "same-origin" });
    return { status: r.status, body: await r.json() };
  });
  expect(employeeApi.status).toBe(200);
  expect(employeeApi.body.items).toHaveLength(3);
  expect(JSON.stringify(employeeApi.body)).not.toMatch(/allowedRoles|reference-manager-community|マネージャー向け交流会/u);
  await page.route("**/api/workhub/social", route => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":{"message":"unavailable"}}',
  }));
  await social.getByRole("button", { name: "フィードを更新" }).click();
  await expect(social.getByRole("alert")).toContainText("0件とは限りません");
  await expect(social.getByRole("article")).toHaveCount(0);
  await expect(homePreview.getByRole("article")).toHaveCount(0);
  await page.unroute("**/api/workhub/social");
  await social.getByRole("button", { name: "再読み込み" }).click();
  await expect(social.getByRole("article")).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Stage4 manager role gets only the additional authorized fictional community post", async ({ page }) => {
  await login(page, "ren");
  const social = page.getByRole("region", { name: "社内交流フィード" });
  await expect(social.getByRole("article")).toHaveCount(4);
  await expect(social).toContainText("マネージャー向け交流会（デモ）");
});
