import { expect, test } from "@playwright/test";

test("Stage4 company news has one latest-three or full-list view, not duplicate HOME copies", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const items = Array.from({ length: 5 }, (_, i) => ({
    id: `official-demo-${i + 1}`,
    title: `公式お知らせ ${i + 1}`,
    body: `全社向け本文 ${i + 1}`,
    authorId: "workhub-demo-sora",
    publishedAt: new Date(Date.UTC(2026, 9, 12 - i, 4)).toISOString(),
  }));
  let unavailable = false;
  await page.route("**/api/workhub/announcements", route => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: unavailable ? 503 : 200,
      contentType: "application/json",
      body: unavailable ? '{"error":{"message":"unavailable"}}' : JSON.stringify({ items }),
    });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();

  const section = page.locator("#workhub-announcements");
  const list = section.locator("#workhub-announcement-list");
  const articles = list.locator(".workhub-announcement-item");
  await expect(articles).toHaveCount(3);
  await expect(articles.first()).toContainText("公式お知らせ 1");
  await expect(section).toContainText("重要度・部署別の配信指定には未対応");
  await expect(section).toContainText("重要度は未設定");
  await expect(section.getByRole("button", { name: "お知らせを公開" })).toHaveCount(0);
  const summary = section.getByRole("button", { name: "すべてのお知らせを見る" });
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(articles).toHaveCount(5);
  await expect(list.locator("article").filter({ hasText: "公式お知らせ 1" })).toHaveCount(1);
  await expect(section.getByRole("button", { name: "最新3件に戻す" })).toHaveAttribute("aria-expanded", "true");
  await section.getByRole("button", { name: "最新3件に戻す" }).click();
  await expect(articles).toHaveCount(3);
  await expect(section.getByText("公式お知らせ 5")).toHaveCount(0);

  // The existing API is still the only source: a failed read must not leave
  // previously authorized news presented as current.
  unavailable = true;
  await section.getByRole("button", { name: "お知らせを更新" }).click();
  await expect(section.getByRole("alert")).toContainText("お知らせを読み込めませんでした");
  await expect(articles).toHaveCount(0);
  unavailable = false;
  await section.getByRole("button", { name: "再読み込み" }).click();
  await expect(articles).toHaveCount(3);
  await expect(section.getByRole("button", { name: "すべてのお知らせを見る" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
