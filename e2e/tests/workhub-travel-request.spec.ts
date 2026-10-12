import { expect, test, type Page } from "@playwright/test";

const demoPassword = "Workhub-Demo-2026!";

const loginAs = async (page: Page, userId: "aoi" | "ren" | "mei") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(userId);
  await page.getByLabel("パスワード", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(userId === "aoi" ? "Aoi Employee" : userId === "ren" ? "Ren Manager" : "Mei", "u") })).toBeVisible();
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
  await page.getByLabel("目的", { exact: true }).fill(initialPurpose);
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
  // The actionable approval is already represented by MY WORK on HOME, so
  // only the matching action's HOME projection is suppressed; other requests' notifications remain.
  await expect(page.locator("#workhub-notifications")).toContainText("「今日対応すること」に");
  await page.getByRole("button", { name: /通知 未読\d+件/u }).click();
  await expect(page.locator("#workhub-notification-center").getByRole("button",
    { name: /出張申請の承認依頼が届きました/u }).first()).toBeVisible();
  await page.getByRole("button", { name: "ホームへ戻る" }).click();
  await page.getByRole("textbox", { name: "WORKHUBを検索" }).fill(initialPurpose);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.locator(".workhub-global-search-results").getByRole("button", { name: new RegExp(initialPurpose, "u") })).toBeVisible();
  const correctionMessage = "日程を確認してください。開始日を1日後ろに変更してください";
  await firstTask.getByRole("textbox", { name: `${initialPurpose}の差戻し理由` }).fill(correctionMessage);
  await firstTask.getByRole("button", { name: "差し戻す" }).click();
  await expect(page.getByText("差し戻しました。", { exact: true })).toBeVisible();

  await switchPersona(page, "aoi");
  await expect(page.locator(".workhub-my-requests").getByRole("button",
    { name: new RegExp(initialPurpose, "u") })).toContainText("差戻し・要修正");
  // Returned is actionable MY WORK: show the one HOME work card, while
  // retaining the unread notification in the full Notification Center.
  await expect(page.locator("#workhub-notifications")).toContainText("「今日対応すること」に");
  await page.getByRole("button", { name: /通知 未読\d+件/u }).click();
  await expect(page.locator("#workhub-notification-center").getByRole("button",
    { name: /出張申請が差し戻されました/u }).first()).toBeVisible();
  await page.getByRole("button", { name: "ホームへ戻る" }).click();
  // A returned request can be corrected directly from MY REQUESTS,
  // without first opening the notification or navigating to details.
  const returnedItem = page.locator(".workhub-my-requests").getByRole("button",
    { name: new RegExp(initialPurpose, "u") });
  await expect(returnedItem).toContainText("選択して修正・再申請する");
  await expect(returnedItem).toContainText(correctionMessage);
  await returnedItem.click();
  await expect(page.getByRole("heading", { name: "出張申請を修正" })).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "差戻し理由" })).toContainText(correctionMessage);
  await expect(page.getByLabel("目的", { exact: true })).toHaveValue(initialPurpose);
  await expect(page.getByLabel("目的", { exact: true })).toBeFocused();
  await expect(page.getByText("差し戻されました", { exact: true })).toBeVisible();
  await page.getByLabel("目的", { exact: true }).fill(correctedPurpose);
  await page.getByRole("button", { name: "修正して再申請" }).click();
  await expect(page.getByText("出張申請を再申請しました。", { exact: true })).toBeVisible();
  await expect(page.locator(".workhub-return-reason")).toHaveCount(0);
  await expect(page.locator(".workhub-my-requests").getByText(`差戻し理由：${correctionMessage}`)).toHaveCount(0);
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
  // A zero-hit search now explains which query and category were searched.
  await expect(page.getByRole("region", { name: "検索結果", exact: true })
    .getByText("「" + correctedPurpose + "」に一致する結果はありません（カテゴリ：すべて）。")).toBeVisible();

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

  // A linked expense advances the same trip's journey, without changing the
  // source travel workflow or inferring anything about payment execution.
  const tripCard = page.locator("#workhub-my-requests .workhub-journey-entry")
    .filter({ hasText: correctedPurpose });
  await expect(tripCard).toContainText("① 出張申請：承認済み");
  await expect(tripCard).toContainText("② 紐づく経費精算：紐づいた精算は未登録");
  await tripCard.getByRole("button", { name: "この出張の経費精算を始める" }).click();
  const expenseArea = page.locator("#workhub-expenses");
  await expect(expenseArea.getByLabel("紐づける出張申請")).toHaveValue(
    await expenseArea.getByLabel("紐づける出張申請").locator("option", { hasText: correctedPurpose }).getAttribute("value") ?? "",
  );
  const expensePurpose = `承認済み出張の精算 E2E ${suffix}`;
  await expenseArea.getByLabel("精算の目的").fill(expensePurpose);
  await expenseArea.getByLabel("明細1の利用日").fill("2026-10-21");
  await expenseArea.getByLabel("明細1の内容").fill("電車代");
  await expenseArea.getByLabel("明細1の金額").fill("1200");
  await expenseArea.getByRole("button", { name: "経費精算を提出", exact: true }).click();
  await expect(expenseArea.getByText("経費精算を提出しました。")).toBeVisible();
  await expect(tripCard).toContainText("② 紐づく経費精算：経理確認中（1件）");

  await switchPersona(page, "mei");
  const accountingItem = page.locator("#workhub-expenses .workhub-expense-item")
    .filter({ hasText: expensePurpose });
  await expect(accountingItem).toContainText("経理確認待ち");
  await accountingItem.getByRole("button", { name: "経費を承認する" }).click();
  await expect(page.getByText("経費精算を承認しました。")).toBeVisible();

  await switchPersona(page, "aoi");
  await expect(page.locator("#workhub-my-requests .workhub-my-request-item")
    .filter({ hasText: correctedPurpose })).toContainText(
    "② 紐づく経費精算：経理承認済み（1件）",
  );
});


test("MY REQUESTS shows persisted personal requests and never exposes another employee's list", async ({ page }, testInfo) => {
  const purpose = `MY REQUESTS E2E ${testInfo.project.name}`;
  await loginAs(page, "aoi");
  await expect(page.getByRole("heading", { name: "自分の申請一覧" })).toBeVisible();
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("目的", { exact: true }).fill(purpose);
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
  const requestItem = page.getByRole("button", { name: new RegExp(purpose, "u") });
  await expect(requestItem).toBeVisible();

  await expect(requestItem).toContainText("承認待ち");
  await page.reload();
  await expect(page.getByRole("heading", { name: "自分の申請一覧" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(purpose, "u") })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(purpose, "u") }).click();
  await expect(page.getByText("MY REQUEST DETAIL", { exact: true })).toBeVisible();
  await expect(page.getByText("申請しました", { exact: true })).toBeVisible();
  // Print only the currently authorized submitted request. The browser can
  // save this presentation to PDF; it is NOT the historical approval report.
  const printButton = page.getByRole("button", { name: "申請内容を印刷・PDF保存" });
  await expect(printButton).toBeVisible();
  await page.evaluate(() => {
    window.print = () => { document.documentElement.dataset.workhubPrintInvoked = "yes"; };
  });
  await printButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-workhub-print-invoked", "yes");
  await page.emulateMedia({ media: "print" });
  const printSheet = page.getByRole("region", { name: "出張申請内容（印刷用）" });
  await expect(printSheet).toBeVisible();
  await expect(printSheet).toContainText(purpose);
  await expect(printSheet).toContainText("正式な承認証跡、電子署名付きPDFではありません");
  await expect(page.locator("#workhub-requests")).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  await switchPersona(page, "ren");
  await expect(page.getByRole("heading", { name: "自分の申請一覧" })).toHaveCount(0);
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
