import { expect, test } from "@playwright/test";

test("Stage3 unified search enforces facets and authorization on mobile without stale error results", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();

  const form = page.getByRole("search");
  const query = form.getByRole("textbox", { name: "WORKHUBを検索" });
  const category = form.getByRole("combobox", { name: "検索カテゴリ" });
  const button = form.getByRole("button", { name: "検索", exact: true });
  const results = page.getByRole("region", { name: "検索結果", exact: true });

  await query.fill("出張");
  await category.selectOption("documents");
  await button.click();
  const matchingDocument = results.getByRole("link", { name: /^出張と経費精算の手順（デモ）/u });
  await expect(matchingDocument).toBeVisible();
  await matchingDocument.click();
  await expect(page).toHaveURL(/#workhub-document-travel-expense-current$/u);
  const documentCard = page.getByRole("article", { name: "文書 出張と経費精算の手順（デモ）" });
  await expect(documentCard).toBeInViewport();
  await expect(documentCard).toHaveCSS("outline-style", "solid");
  await expect(results).toContainText("旧版・利用注意");
  await expect(results).not.toContainText("インシデント");
  await expect(results.getByRole("status")).toContainText("閲覧可能な結果");

  const unauthorized = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/search?q=" + encodeURIComponent("インシデント") + "&category=documents", { credentials: "same-origin" });
    return { status: response.status, body: await response.json() };
  });
  expect(unauthorized.status).toBe(200);
  expect(unauthorized.body.results).toEqual([]);
  expect(JSON.stringify(unauthorized.body)).not.toContain("管理者向け");

  await category.selectOption("people");
  await query.fill("Ren");
  await button.click();
  await expect(results.getByRole("link", { name: /Ren Manager/ })).toBeVisible();
  await expect(results.getByRole("link")).toHaveCount(1);
  await results.getByRole("link", { name: /Ren Manager/ }).click();
  await expect(page).toHaveURL(/#workhub-person-reference-person-3$/u);
  const personCard = page.getByRole("article", { name: "社員 Ren Manager" });
  await expect(personCard).toBeInViewport();
  await expect(personCard).toHaveCSS("outline-style", "solid");

  // A valid zero-hit result is neither a 503 nor an authorization bypass:
  // show the real search/facet and give a safe way back to a broader search.
  await category.selectOption("documents");
  await button.click();
  await expect(results.getByText("「Ren」に一致する結果はありません（カテゴリ：文書）。")).toBeVisible();
  await expect(results.getByRole("button", { name: "カテゴリを「すべて」に戻す" })).toBeVisible();
  await results.getByRole("button", { name: "カテゴリを「すべて」に戻す" }).click();
  await expect(category).toHaveValue("all");
  await expect(query).toHaveValue("Ren");
  await expect(query).toBeFocused();
  await expect(results).toHaveCount(0);
  await button.click();
  await expect(results.getByRole("link", { name: /Ren Manager/u })).toBeVisible();

  await page.route("**/api/workhub/search?**", route => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":{"message":"unavailable"}}',
  }));
  await button.click();
  await expect(results.getByRole("alert")).toContainText("0件とは限りません");
  await expect(results.getByRole("link")).toHaveCount(0);
  await page.unroute("**/api/workhub/search?**");
  await results.getByRole("button", { name: "再検索" }).click();
  await expect(results.getByRole("link", { name: /Ren Manager/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
