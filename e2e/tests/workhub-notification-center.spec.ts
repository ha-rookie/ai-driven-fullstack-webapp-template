import { expect, test } from "@playwright/test";

test("Stage4 notification center reuses the current user projection with unread filtering and keyboard recovery", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const items = [
    { id: "notification-demo-one", notificationType: "workflow.returned", actionTarget: null, version: 1, readAt: null, createdAt: "2026-10-12T08:30:00.000Z" },
    { id: "notification-demo-two", notificationType: "workflow.approved", actionTarget: null, version: 2, readAt: "2026-10-12T09:10:00.000Z", createdAt: "2026-10-12T08:40:00.000Z" },
  ];
  let listUnavailable = false;
  await page.route("**/api/workhub/notifications", route => route.fulfill({
    status: listUnavailable ? 503 : 200,
    contentType: "application/json",
    body: listUnavailable ? '{"error":{"message":"unavailable"}}' : JSON.stringify({ items }),
  }));
  await page.route("**/api/workhub/notifications/unread-count", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ unreadCount: 1 }),
  }));

  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const bell = page.getByRole("button", { name: "通知 未読1件" });
  await expect(bell).toBeVisible();
  await bell.focus();
  await page.keyboard.press("Enter");

  const center = page.locator("#workhub-notification-center");
  await expect(center.getByRole("heading", { name: "通知センター" })).toBeFocused();
  await expect(bell).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".workhub-portal-layout")).toBeHidden();
  await expect(center.getByText("未読は対応が必要な仕事の件数ではありません")).toBeVisible();
  await expect(center.locator(".workhub-notification-center-item")).toHaveCount(2);
  await center.getByRole("button", { name: "未読のみ" }).click();
  await expect(center.getByRole("button", { name: "未読のみ" })).toHaveAttribute("aria-pressed", "true");
  await expect(center.locator(".workhub-notification-center-item")).toHaveCount(1);
  await expect(center).toContainText("出張申請が差し戻されました");
  await expect(center).not.toContainText("出張申請が承認されました");
  await center.getByRole("button", { name: "すべて", exact: true }).click();
  await expect(center.locator(".workhub-notification-center-item")).toHaveCount(2);

  listUnavailable = true;
  await center.getByRole("button", { name: "通知を更新" }).click();
  await expect(center.getByRole("alert")).toContainText("0件とは限りません");
  await expect(center.locator(".workhub-notification-center-item")).toHaveCount(0);
  listUnavailable = false;
  await center.getByRole("button", { name: "再読み込み" }).click();
  await expect(center.locator(".workhub-notification-center-item")).toHaveCount(2);
  await center.getByRole("button", { name: "ホームへ戻る" }).click();
  await expect(page.locator(".workhub-portal-layout")).toBeVisible();
  await expect(bell).toHaveAttribute("aria-expanded", "false");
  await expect(bell).toBeFocused();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
