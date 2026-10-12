import { expect, test } from "@playwright/test";

test("Stage3 role-filtered documents explain stale/old versions, are readable on 390px, and recover from GET failure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect((await page.request.get("/api/workhub/documents")).status()).toBe(401);
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();
  const region = page.getByRole("region", { name: "ナレッジ" });
  await page.getByRole("navigation", { name: "WORKHUB メインナビゲーション" })
    .getByRole("link", { name: "ナレッジ" }).click();
  await expect(region).toBeInViewport();
  await expect(region.getByRole("article")).toHaveCount(4);
  await expect(region).toContainText("現行");
  await expect(region).toContainText("要再確認");
  await expect(region).toContainText("旧版・参照注意");
  await expect(region).toContainText("v3");
  await expect(region).toContainText("確認日：2026-10-05");
  await expect(region).toContainText("現行文書：出張と経費精算の手順（デモ）");
  await expect(region).not.toContainText("インシデント対応");

  const result = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/documents", { credentials: "same-origin" });
    return { status: response.status, payload: await response.json() };
  });
  expect(result.status).toBe(200);
  const items = result.payload.items as Array<{ title: string; version: number; state: string }>;
  expect(items).toHaveLength(4);
  expect(items.every(x => x.version > 0 && !!x.state)).toBe(true);
  expect(JSON.stringify(result.payload)).not.toMatch(/allowedRoles|incident-management|workhub-demo-|email|phone|password/iu);

  await page.route("**/api/workhub/documents", route => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":{"message":"unavailable"}}',
  }));
  await region.getByRole("button", { name: "文書一覧を更新" }).click();
  await expect(region.getByRole("alert")).toContainText("0件とは限りません");
  await expect(region.getByRole("article")).toHaveCount(0);
  await page.unroute("**/api/workhub/documents");
  await region.getByRole("button", { name: "再読み込み" }).click();
  await expect(region.getByRole("article")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
