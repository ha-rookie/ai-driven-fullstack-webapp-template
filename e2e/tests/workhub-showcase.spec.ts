import { expect, test } from "@playwright/test";

test("public showcase explains the reference, offers real demo and source evidence", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (/^\/api\//u.test(new URL(request.url()).pathname)
      && !["GET", "HEAD", "OPTIONS"].includes(request.method())) mutations.push(request.url());
  });
  await page.goto("/showcase");
  await expect(page.getByRole("heading", { level: 1, name: /業務システムを/u })).toBeVisible();
  await expect(page.getByText("架空企業のReference Applicationです。", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "「動く」を、設計の根拠まで。" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /出張申請から、/u })).toBeVisible();

  const tour = page.locator("#showcase-tour");
  await expect(tour).toContainText("Aoi · 一般社員");
  await tour.getByRole("button", { name: "次へ →" }).click();
  await expect(tour).toContainText("上長が差し戻し、社員が再申請する");
  await tour.getByRole("button", { name: "次へ →" }).click();
  await expect(tour).toContainText("承認後も、何が起きたか追える");
  await tour.getByRole("button", { name: "次へ →" }).click();
  await expect(tour).toContainText("検索・帳票も、現在の権限で確認する");
  await expect(tour.getByRole("link", { name: "実際のデモを試す →" })).toHaveAttribute("href", "/");
  await expect(tour.getByRole("link", { name: "E2Eテスト ↗" }))
    .toHaveAttribute("href", /github.com\/ha-rookie\/ai-driven-fullstack-webapp-template\/blob\/main\/e2e\/tests\/workhub-travel-request.spec.ts/u);
  await expect(page.locator(".showcase-status-grid")).toContainText("NOT IMPLEMENTED");
  await expect(page.locator(".showcase-status-grid")).toContainText("外部SaaSの受領結果を実照合するAdapter");
  await expect(page.getByRole("link", { name: "GitHub Source ↗" }))
    .toHaveAttribute("href", "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template");
  expect(mutations).toEqual([]);
});

test("showcase works without login and stays separate from WORKHUB auth", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await page.getByRole("link", { name: "WORKHUB Showcaseを見る ↗" }).click();
  await expect(page).toHaveURL(/\/showcase\/?$/u);
  await expect(page.getByRole("heading", { level: 1, name: /業務システムを/u })).toBeVisible();
  await page.getByRole("link", { name: "WORKHUBを試す ↗" }).click();
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
});

test("mobile tour retains step controls, demo entry and evidence links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/showcase");
  await expect(page.getByRole("heading", { level: 1, name: /業務システムを/u })).toBeVisible();
  await expect(page.locator("#showcase-tour").getByRole("button", { name: "04" })).toBeVisible();
  await page.locator("#showcase-tour").getByRole("button", { name: "04" }).click();
  await expect(page.locator("#showcase-tour")).toContainText("検索・帳票も、現在の権限で確認する");
  await expect(page.getByRole("link", { name: "実際のデモを試す →" })).toBeVisible();
  await expect(page.locator("#showcase-tour").getByRole("link", { name: "E2Eテスト ↗" })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});
