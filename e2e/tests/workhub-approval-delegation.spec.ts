import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, persona: "aoi" | "ren" | "mei" | "kai") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(persona);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const name = { aoi: "Aoi Employee", ren: "Ren Manager", mei: "Mei Accounting", kai: "Kai Admin" }[persona];
  await expect(page.getByRole("heading", { name: new RegExp(name, "u") })).toBeVisible();
};
const change = async (page: Page, persona: "aoi" | "ren" | "mei" | "kai") => {
  await page.context().clearCookies();
  await login(page, persona);
};
const submitTravel = async (page: Page, purpose: string) => {
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("開始日").fill("2026-10-20");
  await page.getByLabel("終了日").fill("2026-10-21");
  await page.getByLabel("目的", { exact: true }).fill(purpose);
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
};

test("explicit manager delegation shows travel work only within grant, and revocation restores deny", async ({ page }, info) => {
  // This scenario mutates one named Reference grant; run only once per CI run.
  test.skip(info.project.name !== "desktop-chromium", "single shared grant is tested at 390px in desktop project");
  test.setTimeout(100_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const first = "出張代理承認 " + info.project.name + " " + Date.now();
  const afterRevoke = first + " 取消後";
  await login(page, "aoi");
  await submitTravel(page, first);

  await change(page, "ren");
  // A previous local run must not implicitly authorize this test.
  const enabled = page.getByRole("button", { name: "Meiへ24時間委任する" });
  const revoked = page.getByRole("button", { name: "代理承認を取り消す" });
  await expect(enabled.or(revoked)).toBeVisible();
  if (await revoked.isVisible()) {
    await revoked.click();
    await expect(enabled).toBeVisible();
  }

  await change(page, "mei");
  await expect(page.locator("#workhub-my-work").getByText(first, { exact: true })).toHaveCount(0);
  // Even an Accounting persona cannot create its own manager delegation.
  const deniedGrant = await page.evaluate(async () => {
    const csrf = await fetch("/api/auth/csrf").then(r => r.json()) as { csrfToken: string };
    const response = await fetch("/api/workhub/approval-delegation", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf.csrfToken },
      body: JSON.stringify({ enabled: true }),
    });
    return response.status;
  });
  expect(deniedGrant).toBe(403);

  await change(page, "ren");
  await enabled.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Meiへ委任中" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "出張承認の代理設定" })).toBeFocused();
  await change(page, "mei");
  const task = page.getByRole("article", { name: `${first}の出張承認タスク` });
  await expect(task.getByRole("heading", { level: 3, name: first })).toBeVisible();
  await expect(task.getByRole("button", { name: `${first}：差し戻す`, exact: true })).toBeVisible();
  await expect(task.getByRole("button", { name: `${first}：承認する`, exact: true })).toBeVisible();
  await expect(task).toContainText("Renの代理として操作・記録します");
  const record = await page.evaluate(async purpose => {
    const response = await fetch("/api/workhub/my-work", { credentials: "same-origin" });
    if (!response.ok) throw new Error("MY WORK read failed");
    const payload = await response.json() as { items: Array<{
      workItem: { assigneePrincipal: string };
      request: { purpose: string };
    }> };
    return payload.items.find(item => item.request.purpose === purpose)?.workItem.assigneePrincipal ?? "";
  }, first);
  expect(record).toBe("workhub-demo-ren"); // Delegation never forges assignee identity.
  await task.getByRole("button", { name: `${first}：承認する`, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("承認しました。", { exact: true })).toBeVisible();
  await expect(task).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "今日対応すること" })).toBeFocused();

  await change(page, "ren");
  await revoked.click();
  await expect(enabled).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "出張承認の代理設定" })).toBeFocused();

  await change(page, "aoi");
  await submitTravel(page, afterRevoke);
  await change(page, "mei");
  await expect(page.locator("#workhub-my-work").getByText(afterRevoke, { exact: true })).toHaveCount(0);
  await change(page, "kai");
  const deniedAdmin = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/approval-delegation", { credentials: "same-origin" });
    return response.status;
  });
  expect(deniedAdmin).toBe(403);
});

test("390px delegation reconciles committed-but-lost POST and blocks unsafe retry until GET recovers", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "named Reference grant is tested once per CI");
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "ren");
  const enable = page.getByRole("button", { name: "Meiへ24時間委任する" });
  const revoke = page.getByRole("button", { name: "代理承認を取り消す" });
  await expect(enable.or(revoke)).toBeVisible();
  if (await revoke.isVisible()) {
    await revoke.click();
    await expect(enable).toBeVisible();
  }

  // Route the POST to the server ONCE, then hide only the successful response:
  // the browser must reconcile via GET without repeating the privilege grant.
  let grantPosts = 0;
  await page.route("**/api/workhub/approval-delegation", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    grantPosts += 1;
    const original = await route.fetch();
    if (!original.ok()) return route.fulfill({ response: original });
    return route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ error: { code: "response_lost", message: "response was lost after commit" } }),
    });
  });
  await enable.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/委任処理の応答を確認できませんでした/u)).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "出張承認の代理設定" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Meiへ委任中" })).toBeVisible();
  await expect(revoke).toBeVisible();
  expect(grantPosts, "grant must not be replayed following an ambiguous result").toBe(1);
  await page.unroute("**/api/workhub/approval-delegation");

  // A successful revoke followed by a failed GET is also ambiguous to the UI:
  // no further POST is permitted until an explicit read-only refresh succeeds.
  let revokePosts = 0;
  await page.route("**/api/workhub/approval-delegation", async (route) => {
    if (route.request().method() === "POST") {
      revokePosts += 1;
      return route.continue();
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await revoke.click();
  await expect(page.getByText("委任処理の結果を確認できません。再送信せず、委任状態を再確認してください。")).toBeVisible();
  await expect(revoke).toHaveCount(0);
  await expect(enable).toHaveCount(0);
  const retryRead = page.getByRole("button", { name: "委任状態を再確認" });
  await expect(retryRead).toBeVisible();
  expect(revokePosts, "revocation must only be sent once").toBe(1);
  await page.unroute("**/api/workhub/approval-delegation");
  await retryRead.focus();
  await page.keyboard.press("Enter");
  await expect(enable).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "現在、代理承認は無効です" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "出張承認の代理設定" })).toBeFocused();
  expect(revokePosts, "refresh must be read-only").toBe(1);
});
