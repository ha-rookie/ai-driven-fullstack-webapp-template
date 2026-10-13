import { expect, test } from "@playwright/test";

// Verify Japanese Reference labels explicitly; default Chromium locale may be en-US.
test.use({ locale: "ja-JP" });

test("Stage6 Reference Developer Mode shows safe screen-to-source and closes without business mutations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();

  const unexpected: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      unexpected.push(request.method() + " " + new URL(request.url()).pathname);
    }
  });
  await page.getByLabel("ユーザーメニュー", { exact: true }).click();
  const entry = page.getByRole("button", { name: "Developer Mode — この画面の実装情報" });
  await expect(entry).toBeVisible();
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "Developer Mode" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "閉じる" })).toBeFocused();
  await expect(dialog).toContainText("workhub.home");
  await expect(dialog).toContainText("MY WORK");
  await expect(dialog).toContainText("表示用Projection");
  await expect(dialog).toContainText("Reference");

  await dialog.getByRole("combobox", { name: "ほかの画面も確認" }).selectOption("requests");
  await expect(dialog).toContainText("travel-request-settlement");
  await expect(dialog).toContainText("Travel Request Domain");
  await expect(dialog).toContainText("Human Workflow");
  await expect(dialog.getByRole("link", { name: "src/reference/workhub/travel-request/service.ts" })).toHaveAttribute("href", /github.com\/ha-rookie\/ai-driven-fullstack-webapp-template\/blob\/main/u);
  await expect(dialog).not.toContainText("Workhub-Demo-2026!");
  expect(unexpected).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await expect(page.locator("#workhub-travel-form")).toBeVisible();
});

test("Developer Mode preserves the requested screen context when opened from APPS", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("ren");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Ren Managerさん/u })).toBeVisible();
  await page.getByRole("link", { name: "アプリ一覧", exact: true }).click();
  await page.getByLabel("ユーザーメニュー", { exact: true }).click();
  const entry = page.getByRole("button", { name: "Developer Mode — この画面の実装情報" });
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "Developer Mode" });
  await expect(dialog).toContainText("workhub.apps");
  await expect(dialog).toContainText("App catalog");
  await expect(dialog).not.toContainText("Aoi Employee");
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(entry).toBeFocused();
});
