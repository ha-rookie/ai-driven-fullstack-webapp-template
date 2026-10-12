import { expect, test } from "@playwright/test";

for (const [persona, screenName, linkName, target] of [
  ["Mei Accounting", "Mei Accounting", "経費確認画面を開く", "#workhub-expenses"],
  ["Sora Corporate", "Sora Corporate", "社内お知らせを管理する", "#workhub-announcements"],
  ["Kai Admin", "Kai Admin", "管理ポータルを開く", "/admin"],
] as const) {
  test(`HOME MY WORK offers the existing authorized workspace for ${screenName}`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
    await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
      .getByRole("button", { name: new RegExp(persona, "u") }).click();
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`おはようございます、${screenName}さん`, "u") })).toBeVisible();
    const myWork = page.getByRole("region", { name: "今日の仕事" });
    const link = myWork.getByRole("link", { name: linkName });
    await expect(link).toHaveAttribute("href", target);
    await expect(myWork.getByText("このデモ利用者向けのMY WORKは未接続です。")).toHaveCount(0);
    if (persona === "Mei Accounting") {
      await expect(myWork.locator(".workhub-summary-count")).toHaveText(/\d+/u);
    } else {
      await expect(myWork.getByText("—")).toBeVisible();
    }
  });
}

test("HOME notifications report failed fetch separately from zero and offer a read-only retry", async ({ page }) => {
  await page.route("**/api/workhub/notifications", route =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const notice = page.locator("#workhub-notifications");
  await expect(notice.getByRole("alert")).toContainText("0件とは限りません");
  await expect(notice.getByText("通知はありません。")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "通知 取得状況を確認" })).toBeVisible();

  await page.unroute("**/api/workhub/notifications");
  await notice.getByRole("button", { name: "通知を再読み込み" }).click();
  await expect(notice.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /通知 未読\d+件/u })).toBeVisible();
});
