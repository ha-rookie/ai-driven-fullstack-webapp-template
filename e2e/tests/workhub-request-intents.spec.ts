import { expect, test } from "@playwright/test";

test("Stage 2 REQUESTS navigation finds a real workflow without pretending guided journeys are live", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.getByRole("navigation", { name: "WORKHUB メインナビゲーション" })
    .getByRole("link", { name: "申請・手続き" }).click();

  const intents = page.locator("#workhub-request-intents");
  await expect(intents).toBeInViewport();
  await expect(intents.getByRole("heading", { name: "申請・手続きを探す" })).toBeVisible();
  const travel = intents.getByRole("article").filter({ has: page.getByRole("heading", { name: "出張したい" }) });
  await expect(travel.getByRole("link", { name: "手続きを開く" })).toHaveAttribute("href", "/#workhub-requests");
  const moving = intents.getByRole("article").filter({ has: page.getByRole("heading", { name: "引っ越した" }) });
  await expect(moving.getByRole("link", { name: "手続きの進捗デモを開く" }))
    .toHaveAttribute("href", "/#workhub-secondary-journeys");
  await expect(moving).toContainText("実際の人事情報は更新しません");
});

test("Stage 2 REQUESTS shows only role-allowed workflow links", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Ren Manager/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const intents = page.locator("#workhub-request-intents");
  await expect(intents.getByRole("heading", { name: "申請を承認したい" })).toBeVisible();
  await expect(intents.getByRole("heading", { name: "出張したい" })).toHaveCount(0);
  await expect(intents.getByRole("link", { name: "手続きを開く" })).toHaveCount(1);
  await expect(intents.getByRole("link", { name: "手続きの進捗デモを開く" })).toHaveCount(0);
});
