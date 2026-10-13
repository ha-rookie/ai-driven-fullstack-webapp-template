import { expect, test } from "@playwright/test";

for (const sample of [
  { locale: "ja-JP", theme: "light", tab: "全体ガイド", state: "Reference実装" },
  { locale: "en-US", theme: "dark", tab: "Full guide", state: "Reference implementation" },
] as const) {
  test.describe(`Stage6 locale/theme ${sample.locale} ${sample.theme}`, () => {
    test.use({ locale: sample.locale });
    test("Developer Mode stays readable and technical keys stable", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: sample.theme });
      await page.goto("/");
      await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
      await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
      await page.getByRole("button", { name: "ログイン", exact: true }).click();
      await page.getByLabel("ユーザーメニュー", { exact: true }).click();
      await page.getByRole("button", { name: "Developer Mode — この画面の実装情報" }).click();
      const dialog = page.getByRole("dialog", { name: "Developer Mode" });
      await expect(dialog).toContainText(sample.state);
      await expect(dialog).toContainText("workhub.home");
      await dialog.getByRole("button", { name: sample.tab }).click();
      await expect(dialog.getByRole("heading", { name: "Architecture Map" })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Screen Catalog" })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Adapter / Integration Map" })).toBeVisible();
      await expect(dialog).toContainText("secondary-journeys");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });
  });
}
