import { expect, test, type Page } from "@playwright/test";

// All faults use only local Playwright routes. Never submit a workflow
// mutation to validate recovery from a read-only MY WORK failure.
const signInRen = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("ren");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Ren Managerさん/u })).toBeVisible();
  return page.getByRole("region", { name: "今日の仕事" });
};

test("confirmed empty MY WORK is a calm 0-item state on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let reads = 0;
  let mutations = 0;
  page.on("request", request => {
    if (/\/api\/workhub\/workflows\/.*\/(approve|return)$/u.test(new URL(request.url()).pathname)
      && request.method() === "POST") mutations++;
  });
  await page.route("**/api/workhub/my-work", async route => {
    reads++;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' });
  });
  const work = await signInRen(page);
  const empty = work.locator(".workhub-my-work-empty");
  await expect(empty).toHaveAttribute("role", "status");
  await expect(empty).toContainText("いま、あなたを待っている仕事はありません。");
  await expect(empty).toContainText("確認済みの承認タスクが0件です。");
  await expect(work.locator(".workhub-summary-count")).toHaveText("0");
  await expect(work.getByRole("alert")).toHaveCount(0);
  expect(reads).toBeGreaterThan(0);
  expect(mutations).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

for (const [caseName, response] of [
  ["read provider failure", { status: 502, contentType: "application/json", body: '{"error":{"message":"temporarily_unavailable"}}' }],
  ["malformed successful payload", { status: 200, contentType: "application/json", body: '{"items":null}' }],
] as const) {
  test(`${caseName} is not a false 0 and recovers with GET only`, async ({ page }) => {
    let failing = true;
    let reads = 0;
    let workflowPosts = 0;
    page.on("request", request => {
      if (request.method() === "POST" && /\/api\/workhub\/workflows\//u.test(new URL(request.url()).pathname)) workflowPosts++;
    });
    await page.route("**/api/workhub/my-work", async route => {
      reads++;
      await route.fulfill(failing
        ? response
        : { status: 200, contentType: "application/json", body: '{"items":[]}' });
    });
    const work = await signInRen(page);
    await expect(work.getByRole("alert")).toContainText("承認タスクを取得できませんでした。0件とは限りません。");
    await expect(work.locator(".workhub-summary-count")).toHaveText("—");
    await expect(work.locator(".workhub-my-work-empty")).toHaveCount(0);
    failing = false;
    await work.getByRole("button", { name: "再読み込み" }).click();
    const empty = work.locator(".workhub-my-work-empty");
    await expect(empty).toContainText("確認済みの承認タスクが0件です。");
    await expect(work.getByRole("alert")).toHaveCount(0);
    await expect(work.getByRole("heading", { name: "今日対応すること" })).toBeFocused();
    await expect(work.locator(".workhub-summary-count")).toHaveText("0");
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(workflowPosts, "read failure recovery must never replay business mutations").toBe(0);
  });
}
