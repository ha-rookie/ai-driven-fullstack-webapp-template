import { expect, test, type Page } from "@playwright/test";

const demoPassword = "Workhub-Demo-2026!";

const loginAs = async (page: Page, userId: "aoi" | "ren") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(userId);
  await page.getByLabel("パスワード", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(userId === "aoi" ? "Aoi Employee" : "Ren Manager", "u") })).toBeVisible();
};

const switchPersona = async (page: Page, userId: "aoi" | "ren") => {
  await page.context().clearCookies();
  await page.goto("/");
  await loginAs(page, userId);
};

const latestNotification = (page: Page, label: string) =>
  page.getByRole("button", { name: new RegExp(label, "u") }).first();

test("Aoi and Ren complete submit-return-resubmit-approve with notifications and timeline", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name;
  const initialPurpose = `東京顧客打ち合わせ E2E ${suffix}`;
  const correctedPurpose = `${initialPurpose} 修正版`;

  await loginAs(page, "aoi");

  await expect(page.getByText("REQUESTS / 出張したい", { exact: true })).toBeVisible();
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("開始日").fill("2026-10-20");
  await page.getByLabel("終了日").fill("2026-10-21");
  await page.getByLabel("目的").fill(initialPurpose);
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
  await expect(page.getByText("申請しました", { exact: true })).toBeVisible();
  await expect(page.locator(".workhub-my-requests").getByRole("button",
    { name: new RegExp(initialPurpose, "u") })).toContainText("承認待ち");
  await page.getByRole("textbox", { name: "WORKHUBを検索" }).fill(initialPurpose);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.locator(".workhub-global-search-results").getByRole("button", { name: new RegExp(initialPurpose, "u") })).toBeVisible();

  await switchPersona(page, "ren");
  const firstTask = page.getByText(initialPurpose, { exact: true }).locator("..");
  await expect(firstTask).toBeVisible();
  await expect(latestNotification(page, "出張申請の承認依頼が届きました")).toBeVisible();
  await page.getByRole("textbox", { name: "WORKHUBを検索" }).fill(initialPurpose);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.locator(".workhub-global-search-results").getByRole("button", { name: new RegExp(initialPurpose, "u") })).toBeVisible();
  await firstTask.getByRole("button", { name: "差し戻す" }).click();
  await expect(page.getByText("差し戻しました。", { exact: true })).toBeVisible();

  await switchPersona(page, "aoi");
  const returnedNotification = latestNotification(page, "出張申請が差し戻されました");
  await expect(returnedNotification).toBeVisible();
  await expect(page.locator(".workhub-my-requests").getByRole("button",
    { name: new RegExp(initialPurpose, "u") })).toContainText("差戻し・要修正");
  await returnedNotification.click();
  await expect(page.getByRole("heading", { name: "出張申請を修正" })).toBeVisible();
  await expect(page.getByText("差し戻されました", { exact: true })).toBeVisible();
  await page.getByLabel("目的").fill(correctedPurpose);
  await page.getByRole("button", { name: "修正して再申請" }).click();
  await expect(page.getByText("出張申請を再申請しました。", { exact: true })).toBeVisible();
  await expect(page.getByText("再申請しました", { exact: true })).toBeVisible();
  await expect(page.locator(".workhub-my-requests").getByRole("button",
    { name: new RegExp(correctedPurpose, "u") })).toContainText("承認待ち");

  await switchPersona(page, "ren");
  const secondTask = page.getByText(correctedPurpose, { exact: true }).locator("..");
  await expect(secondTask).toBeVisible();
  await secondTask.getByRole("button", { name: "承認する" }).click();
  await expect(page.getByText("承認しました。", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "WORKHUBを検索" }).fill(correctedPurpose);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByText("該当する検索結果はありません。", { exact: true })).toBeVisible();

  await switchPersona(page, "aoi");
  const approvedNotification = latestNotification(page, "出張申請が承認されました");
  await expect(approvedNotification).toBeVisible();
  await expect(page.locator(".workhub-my-requests").getByRole("button",
    { name: new RegExp(correctedPurpose, "u") })).toContainText("承認済み");
  await approvedNotification.click();
  await expect(page.getByText("Workflow:", { exact: false })).toContainText("completed");
  await expect(page.getByText("申請しました", { exact: true })).toBeVisible();
  await expect(page.getByText("差し戻されました", { exact: true })).toBeVisible();
  await expect(page.getByText("再申請しました", { exact: true })).toBeVisible();
  await expect(page.getByText("承認されました", { exact: true })).toBeVisible();
});


test("MY REQUESTS shows persisted personal requests and never exposes another employee's list", async ({ page }, testInfo) => {
  const purpose = `MY REQUESTS E2E ${testInfo.project.name}`;
  await loginAs(page, "aoi");
  await expect(page.getByRole("heading", { name: "自分の出張申請" })).toBeVisible();
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("目的").fill(purpose);
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
  const requestItem = page.getByRole("button", { name: new RegExp(purpose, "u") });
  await expect(requestItem).toBeVisible();

  await expect(requestItem).toContainText("承認待ち");
  await page.reload();
  await expect(page.getByRole("heading", { name: "自分の出張申請" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(purpose, "u") })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(purpose, "u") }).click();
  await expect(page.getByText("MY REQUEST DETAIL", { exact: true })).toBeVisible();
  await expect(page.getByText("申請しました", { exact: true })).toBeVisible();

  await switchPersona(page, "ren");
  await expect(page.getByRole("heading", { name: "自分の出張申請" })).toHaveCount(0);
  // Query parameters supplied by another user must not override server-side session ownership.
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/travel-requests?requesterId=workhub-demo-aoi", {
      credentials: "same-origin",
    });
    return {
      status: response.status,
      data: await response.json() as { items: Array<{ id: string; purpose: string; requesterId: string }> },
    };
  });
  expect(result.status).toBe(200);
  const { items } = result.data;
  expect(items.find((item) => item.purpose === purpose)).toBeUndefined();
  expect(items.every((item) => item.requesterId === "workhub-demo-ren")).toBe(true);
});
