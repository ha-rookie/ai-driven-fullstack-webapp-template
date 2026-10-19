import { expect, test } from "@playwright/test";

test("#433 public Reference provides real Docs → Demo → Source links without API calls", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) apiCalls.push(request.method() + " " + path);
  });

  await page.goto("/reference");
  await expect(page.getByRole("heading", { level: 1, name: /業務Webアプリの設計を/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: "読みたい場所から始める" })).toBeVisible();
  await expect(page.locator(".reference-capability")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "申請と承認" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "認証と認可" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backupと復旧判断" })).toBeVisible();
  await expect(page.getByText("REFERENCE DEMO（架空復旧）")).toBeVisible();
  await expect(page.getByText("Production Restore、Remote D1復元", { exact: false })).toBeVisible();

  const workflow = page.locator("#reference-workflow");
  await expect(workflow.getByRole("link", { name: "WORKHUBで操作する（ログインが必要） →" }))
    .toHaveAttribute("href", "/");
  await expect(workflow.getByRole("link", { name: "Recipe / 設計 ↗" }))
    .toHaveAttribute("href", /docs\/recipes\/REFERENCE_TRAVEL_REQUEST\.md$/u);
  await expect(workflow.getByRole("link", { name: "Source / Contract ↗" }))
    .toHaveAttribute("href", /src\/reference\/workhub\/travel-request\/service\.ts$/u);
  await expect(workflow.getByRole("link", { name: "Test / Evidence ↗" }))
    .toHaveAttribute("href", /e2e\/tests\/workhub-travel-request\.spec\.ts$/u);

  const recovery = page.locator("#reference-recovery");
  await expect(recovery.getByRole("link", { name: "Recovery判断デモを見る（読取専用） →" }))
    .toHaveAttribute("href", "/showcase/#showcase-recovery");
  await expect(recovery.getByRole("link", { name: "Test / Evidence ↗" }))
    .toHaveAttribute("href", /tests\/recovery-showcase\.test\.ts$/u);
  await expect(page.getByRole("link", { name: "Reference Siteの未完了条件を見る ↗" }))
    .toHaveAttribute("href", /issues\/433$/u);
  expect(apiCalls, "public Reference must not request private API, sessions or remote mutations").toEqual([]);
});

test("#433 public Showcase links to Reference on mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/showcase");
  await page.getByRole("link", { name: "設計リファレンス →" }).click();
  await expect(page).toHaveURL(/\/reference$/u);
  await expect(page.getByRole("heading", { level: 1, name: /業務Webアプリの設計を/u })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Reference Site ナビゲーション" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto("/reference/");
  await expect(page.getByRole("heading", { level: 1, name: /業務Webアプリの設計を/u })).toBeVisible();
});
