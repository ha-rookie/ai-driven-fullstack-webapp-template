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
  const unified = page.locator("#workhub-my-requests");
  const expenseCard = unified.locator(".workhub-my-request-item").filter({ hasText: purpose });
  await expect(expenseCard).toContainText("経費精算");
  await expect(expenseCard).toContainText("経理確認待ち");
  await expect(expenseCard).toContainText("合計 13,300円");

  // Two separately owned business domains appear in the same personal list.
  const tripPurpose = `東京出張申請 ${info.project.name} ${Date.now()}`;
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("開始日").fill("2026-10-20");
  await page.getByLabel("終了日").fill("2026-10-21");
  await page.getByLabel("目的", { exact: true }).fill(tripPurpose);
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
  const travelCard = unified.locator(".workhub-my-request-item").filter({ hasText: tripPurpose });
  await expect(travelCard).toContainText("出張申請");
  await expect(travelCard).toContainText("承認待ち");
  await expect(expenseCard).toContainText("経理確認待ち");


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
  const returnedCard = page.locator("#workhub-my-requests .workhub-my-request-item").filter({ hasText: purpose });
  await expect(returnedCard).toContainText("差戻し・要修正");
  await expect(returnedCard).toContainText("ホテルの料金を確認してください");
  // A stale MY REQUESTS projection must never enable editing based only
  // on its old "returned" status. Simulate a newer authoritative detail.
  await page.route("**/api/workhub/expenses/*", async route => {
    if (route.request().method() !== "GET") { await route.continue(); return; }
    const response = await route.fetch();
    const current = await response.json() as { item: Record<string, unknown> };
    await route.fulfill({ response, json: { item: { ...current.item, status: "approved" } } });
  });
  await returnedCard.click();
  await expect(section.getByText("申請状況が更新されています。現在は差戻し中ではないため修正できません。")).toBeVisible();
  await expect(section.getByRole("button", { name: "経費精算を再提出" })).toHaveCount(0);
  await page.unroute("**/api/workhub/expenses/*");

  // A repeated click is a new selection; the current server version must
  // open the correction form without requiring a second list-level button.
  await returnedCard.click();
  await expect(page.getByRole("textbox", { name: "精算の目的" })).toBeFocused();
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
  await expect(page.locator("#workhub-my-requests .workhub-my-request-item").filter({ hasText: purpose }))
    .toContainText("経理承認済み");

  await switchTo(page, "ren");
  await expect(page.locator("#workhub-expenses")).toHaveCount(0);
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/expenses", { credentials: "same-origin" });
    return response.status;
  });
  expect(status).toBe(403);
  const unifiedAccess = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/my-requests", { credentials: "same-origin" });
    return response.status;
  });
  expect(unifiedAccess).toBe(403);
});
