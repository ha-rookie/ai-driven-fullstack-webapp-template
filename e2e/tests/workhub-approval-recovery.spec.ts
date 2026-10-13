import { expect, test, type Page } from "@playwright/test";

// Faults are injected on the local browser fixture only. They never mutate
// Preview/Production data or replay a business POST.
const workItem = {
  workItem: { id: "approval-recovery-item", workflowInstanceId: "approval-recovery-flow", version: 2 },
  workflow: { id: "approval-recovery-flow", state: "awaiting_approval", version: 3 },
  request: {
    id: "approval-recovery-request", purpose: "競合復旧の出張申請",
    destinationOfficeItemId: "office-tokyo", startDate: "2026-10-20", endDate: "2026-10-21",
    status: "submitted", version: 2, workflowInstanceId: "approval-recovery-flow",
  },
};

const loginRen = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("ren");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Ren Managerさん/u })).toBeVisible();
  await expect(page.getByRole("article", { name: "競合復旧の出張申請の出張承認タスク" })).toBeVisible();
};

const mockMyWork = async (page: Page, isPending: () => boolean, onRead: () => void) => {
  await page.route("**/api/workhub/my-work", async route => {
    onRead();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: isPending() ? [workItem] : [] }),
    });
  });
};

test("409 stale approval reads current tasks and never retries the POST", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let pending = true;
  let reads = 0;
  let posts = 0;
  await mockMyWork(page, () => pending, () => { reads++; });
  await page.route("**/api/workhub/workflows/*/approve", async route => {
    posts++;
    pending = false; // another approver won the race; new GET is authoritative
    await route.fulfill({
      status: 409, contentType: "application/json",
      body: JSON.stringify({ error: { message: "version_conflict" } }),
    });
  });
  await loginRen(page);
  await page.getByRole("article", { name: "競合復旧の出張申請の出張承認タスク" })
    .getByRole("button", { name: "承認する" }).click();

  await expect(page.getByText(
    "承認タスクは別の操作で更新されました。最新の一覧を取得しました。内容を確認してください。",
  )).toBeVisible();
  await expect(page.getByRole("article", { name: "競合復旧の出張申請の出張承認タスク" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "今日対応すること" })).toBeFocused();
  expect(posts, "stale approval must not be replayed").toBe(1);
  expect(reads, "409 should trigger a new MY WORK GET").toBeGreaterThanOrEqual(2);
});

test("notification failure after acknowledged approval keeps success and offers GET-only recovery", async ({ page }) => {
  let pending = true;
  let posts = 0;
  let notificationsUnavailable = false;
  await mockMyWork(page, () => pending, () => {});
  await page.route("**/api/workhub/workflows/*/approve", async route => {
    posts++;
    pending = false; // simulate confirmed authoritative workflow transition
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/workhub/notifications", async route => {
    if (!notificationsUnavailable) return route.continue();
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await loginRen(page);
  notificationsUnavailable = true;
  await page.getByRole("article", { name: "競合復旧の出張申請の出張承認タスク" })
    .getByRole("button", { name: "承認する" }).click();

  await expect(page.getByText(
    "承認は完了しました。ただし通知を取得できません。操作を繰り返さず、通知を再読み込みしてください。",
  )).toBeVisible();
  await expect(page.getByRole("article", { name: "競合復旧の出張申請の出張承認タスク" })).toHaveCount(0);
  await expect(page.locator("#workhub-notifications").getByRole("alert")).toContainText("0件とは限りません");
  await expect(page.getByRole("heading", { name: "今日対応すること" })).toBeFocused();
  expect(posts, "successful approval must not be repeated because notification refresh failed").toBe(1);

  notificationsUnavailable = false;
  await page.locator("#workhub-notifications").getByRole("button", { name: "通知を再読み込み" }).click();
  await expect(page.locator("#workhub-notifications").getByRole("alert")).toHaveCount(0);
  expect(posts, "notification GET retry cannot replay approval").toBe(1);
});
