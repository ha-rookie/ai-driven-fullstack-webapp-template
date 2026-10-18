import { expect, test } from "@playwright/test";

test("#431 seven post-restore check results are inspectable in the approved Recovery showcase", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("kai");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Kai Admin/u })).toBeVisible();
  await page.goto("/admin");

  const demo = page.getByTestId("recovery-showcase");
  await expect(demo).toBeVisible();
  await expect(demo.getByTestId("demo-check-dataIntegrity")).toHaveText("PASSED");
  await demo.getByRole("button", { name: "復元テスト失敗" }).click();
  await expect(demo.getByTestId("demo-check-dataIntegrity")).toHaveText("FAILED");
  await expect(demo.getByTestId("demo-check-application")).toHaveText("PASSED");
  await expect(demo.getByTestId("recovery-showcase-readiness")).toHaveText("NOT_READY");
  await demo.getByRole("button", { name: "テスト期限切れ" }).click();
  await expect(demo.getByTestId("recovery-showcase-freshness")).toContainText("STALE");
  await demo.getByRole("button", { name: "復元記録なし" }).click();
  await expect(demo.getByTestId("demo-check-dataIntegrity")).toHaveText("UNKNOWN");
  await demo.getByRole("button", { name: "実証跡未接続" }).click();
  await expect(demo.getByTestId("recovery-showcase-readiness")).toHaveText("UNKNOWN");
  await expect(demo).toContainText("自動復旧: 不可");
});
