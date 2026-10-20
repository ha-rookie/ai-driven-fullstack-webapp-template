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
  await expect(page.locator(".reference-capability")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "権限付き検索" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "PDF帳票の生成" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CSV入出力" })).toBeVisible();

  const search = page.locator("#reference-search");
  await expect(search.getByRole("link", { name: "WORKHUBで出張申請を検索する（ログインが必要） →" }))
    .toHaveAttribute("href", "/");
  await expect(search.getByRole("link", { name: "Test / Evidence ↗" }))
    .toHaveAttribute("href", /workhub-travel-request\.spec\.ts$/u);
  for (const id of ["report", "csv"]) {
    const capability = page.locator("#reference-" + id);
    await expect(capability.getByText("操作デモなし（設計・ソース・テストを参照）")).toBeVisible();
    await expect(capability.getByRole("link", { name: "Recipe / 設計 ↗" })).toBeVisible();
    await expect(capability.getByRole("link", { name: "Source / Contract ↗" })).toBeVisible();
    await expect(capability.getByRole("link", { name: "Test / Evidence ↗" })).toBeVisible();
    await expect(capability.getByRole("link", { name: /WORKHUBで/u })).toHaveCount(0);
  }
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
  const scenarios = page.locator("#reference-scenarios");
  await expect(scenarios.getByRole("heading", { name: "業務の場面から、実装までたどる" })).toBeVisible();
  for (const scenario of ["return", "expense", "search"]) {
    const card = page.locator("#reference-scenario-" + scenario);
    await expect(card.getByRole("link", { name: "ショーケースの該当場面を見る →" }))
      .toHaveAttribute("href", "/showcase?scenario=" + scenario + "#showcase-tour");
    await expect(card.getByRole("link", { name: "Source ↗" }))
      .toHaveAttribute("href", /\/blob\/main\/src\//u);
    await expect(card.getByRole("link", { name: "Browser E2E ↗" }))
      .toHaveAttribute("href", /\/blob\/main\/e2e\/tests\//u);
  }

  const status = page.locator("#reference-status");
  await expect(status.getByRole("heading", { name: "開発状況はGitHubの正本で確認する" })).toBeVisible();
  await expect(status.getByRole("link", { name: "Reference Siteの受入条件 ↗" }))
    .toHaveAttribute("href", /issues\/433$/u);
  await expect(status.getByRole("link", { name: "実装計画・優先順位 ↗" }))
    .toHaveAttribute("href", /issues\/132$/u);
  await expect(status.getByRole("link", { name: "正式System Testの状況 ↗" }))
    .toHaveAttribute("href", /issues\/694$/u);
  await expect(status.getByText("進捗率や公開状態は固定表示せず", { exact: false })).toBeVisible();
  expect(apiCalls, "public Reference must not request private API, sessions or remote mutations").toEqual([]);
});

test("#433 public Showcase links to Reference on mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/showcase");
  await page.getByRole("link", { name: "設計リファレンス →" }).click();
  await expect(page).toHaveURL(/\/reference$/u);
  await expect(page.getByRole("heading", { level: 1, name: /業務Webアプリの設計を/u })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Reference Site ナビゲーション" })).toBeVisible();
  await expect(page.locator(".reference-capability")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("link", { name: "業務シナリオ" }).click();
  await page.locator("#reference-scenario-search")
    .getByRole("link", { name: "ショーケースの該当場面を見る →" }).click();
  await expect(page).toHaveURL(/\/showcase\?scenario=search#showcase-tour$/u);
  await expect(page.locator(".showcase-tour-detail").getByRole("heading", { name: "検索・帳票も、現在の権限で確認する" })).toBeVisible();
  await page.goto("/showcase?scenario=unknown#showcase-tour");
  await expect(page.locator(".showcase-tour-detail").getByRole("heading", { name: "社員が「出張したい」から始める" })).toBeVisible();
  await page.goto("/reference/");
  await expect(page.getByRole("heading", { level: 1, name: /業務Webアプリの設計を/u })).toBeVisible();
});
