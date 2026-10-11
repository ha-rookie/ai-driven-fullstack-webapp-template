import { expect, test } from "@playwright/test";

test("WORKHUB Stage 1 mobile app navigation and keyboard-filter feedback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();

  // Mobile navigation keeps the existing HOME and Header entry points.
  const launcher = page.getByRole("region", { name: "アプリを探す" });
  await page.getByRole("link", { name: "アプリ一覧", exact: true }).click();
  await expect(launcher).toBeInViewport();
  await expect(launcher).toHaveAttribute("tabindex", "-1");

  const search = launcher.getByRole("searchbox", { name: "アプリを検索" });
  const resultRegion = launcher.getByRole("region", { name: "アプリ検索結果" });
  await expect(search).toHaveAttribute("aria-controls", "workhub-app-results");
  await search.fill("出張");
  await expect(launcher.getByRole("status")).toHaveText("2件のアプリが見つかりました。");
  await expect(resultRegion.getByRole("link", { name: "出張申請を開く" })).toBeVisible();

  await search.press("Tab");
  await expect(launcher.getByRole("combobox", { name: "カテゴリ" })).toBeFocused();

  await search.fill("社員・組織");
  await expect(launcher.getByRole("status")).toHaveText("1件のアプリが見つかりました。");
  await expect(resultRegion.getByText("接続準備中")).toBeVisible();
  await expect(resultRegion.getByRole("link")).toHaveCount(0);

  await search.fill("該当しないアプリ名");
  await expect(launcher.getByRole("status")).toHaveText("0件のアプリが見つかりました。");
  await expect(resultRegion.getByText("条件に一致するアプリはありません。")).toBeVisible();
});
