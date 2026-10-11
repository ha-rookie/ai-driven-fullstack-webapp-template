import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, who: "aoi" | "mei" | "ren") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(who);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(who, "iu") })).toBeVisible();
};

const switchTo = async (page: Page, who: "aoi" | "mei" | "ren") => {
  await page.context().clearCookies();
  await page.goto("/");
  await login(page, who);
};

test("employee submits line-item expenses, Accounting returns them, employee corrects and Accounting approves", async ({ page }, info) => {
  const purpose = `出張交通費 E2E ${info.project.name} ${Date.now()}`;
  await login(page, "aoi");
  const section = page.locator("#workhub-expenses");
  await expect(section.getByRole("heading", { name: "交通費・経費精算" })).toBeVisible();
  await section.getByRole("textbox", { name: "精算の目的" }).fill(purpose);
  await section.getByLabel("明細1の利用日").fill("2026-10-20");
  await section.getByLabel("明細1の内容").fill("新幹線");
  await section.getByLabel("明細1の金額").fill("11000");
  await section.getByRole("button", { name: "明細を追加" }).click();
  await section.getByLabel("明細2の利用日").fill("2026-10-21");
  await section.getByLabel("明細2の費目").selectOption("LODGING");
  await section.getByLabel("明細2の内容").fill("宿泊");
  await section.getByLabel("明細2の金額").fill("2300");
  await expect(section.getByText("入力合計（確認用）：13,300円", { exact: false })).toBeVisible();
  await section.getByRole("button", { name: "経費精算を提出", exact: true }).click();
  await expect(section.getByText("経費精算を提出しました。")).toBeVisible();
  const mine = section.locator(".workhub-expense-item").filter({ hasText: purpose });
  await expect(mine).toContainText("経理確認待ち");
  await expect(mine).toContainText("合計 13,300円");

  await switchTo(page, "mei");
  const queue = page.locator("#workhub-expenses").locator(".workhub-expense-item").filter({ hasText: purpose });
  await expect(queue).toContainText("新幹線");
  await expect(queue).toContainText("宿泊");
  await queue.getByRole("textbox", { name: `${purpose}の差戻し理由` }).fill("ホテルの料金を確認してください");
  await queue.getByRole("button", { name: "経費を差し戻す" }).click();
  await expect(page.getByText("経費精算を差し戻しました。")).toBeVisible();

  await switchTo(page, "aoi");
  const returned = page.locator(".workhub-expense-item").filter({ hasText: purpose });
  await expect(returned).toContainText("差戻し・要修正");
  await expect(returned).toContainText("ホテルの料金を確認してください");
  await returned.getByRole("button", { name: "この精算を修正" }).click();
  await expect(page.getByRole("textbox", { name: "精算の目的" })).toHaveValue(purpose);
  await expect(page.getByLabel("明細2の金額")).toHaveValue("2300");
  await page.getByLabel("明細2の金額").fill("2500");
  await page.getByRole("button", { name: "経費精算を再提出" }).click();
  await expect(page.getByText("経費精算を修正して再提出しました。")).toBeVisible();
  await expect(page.locator(".workhub-expense-item").filter({ hasText: purpose })).toContainText("合計 13,500円");

  await switchTo(page, "mei");
  const reviewing = page.locator(".workhub-expense-item").filter({ hasText: purpose });
  await expect(reviewing).toContainText("経理確認待ち");
  await reviewing.getByRole("button", { name: "経費を承認する" }).click();
  await expect(page.getByText("経費精算を承認しました。")).toBeVisible();
  await expect(reviewing).toContainText("経理承認済み");

  await switchTo(page, "aoi");
  await expect(page.locator(".workhub-expense-item").filter({ hasText: purpose })).toContainText("経理承認済み");

  await switchTo(page, "ren");
  await expect(page.locator("#workhub-expenses")).toHaveCount(0);
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/expenses", { credentials: "same-origin" });
    return response.status;
  });
  expect(status).toBe(403);
});
