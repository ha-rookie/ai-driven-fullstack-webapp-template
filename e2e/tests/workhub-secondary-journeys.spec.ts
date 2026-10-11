import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, user: "aoi" | "sora" | "ren") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(user, "iu") })).toBeVisible();
};
const changeIdentity = async (page: Page, user: "aoi" | "sora" | "ren") => {
  await page.context().clearCookies();
  await login(page, user);
};

test("moving simulation persists partial step completion across reload", async ({ page }) => {
  await login(page, "aoi");
  const section = page.locator("#workhub-secondary-journeys");
  await expect(section.getByRole("heading", { name: "手続きの進捗デモ" })).toBeVisible();
  await section.getByRole("button", { name: "引っ越し手続きをデモ開始" }).click();
  const moving = section.locator(".workhub-secondary-item").filter({ hasText: "引っ越した" }).last();
  await expect(moving).toContainText("0/3ステップ");
  await moving.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(moving).toContainText("1/3ステップ");
  await expect(moving).toContainText("住所変更の確認（デモ）");
  await page.reload();
  await expect(section.locator(".workhub-secondary-item").filter({ hasText: "引っ越した" }).first())
    .toContainText("1/3ステップ");
});

test("PC exchange mock transfers assigned work to Corporate and back without admin access", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, "aoi");
  let section = page.locator("#workhub-secondary-journeys");
  await section.getByRole("button", { name: "PC交換をデモ依頼" }).click();
  let pc = section.locator(".workhub-secondary-item").filter({ hasText: "PCを交換したい" }).first();
  await expect(pc).toContainText("0/4ステップ");
  await pc.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(pc).toContainText("1/4ステップ");
  await expect(pc.getByText("現在の担当者による確認待ち")).toBeVisible();

  await changeIdentity(page, "ren");
  await expect(page.locator("#workhub-secondary-journeys")).toHaveCount(0);
  const deniedStatus = await page.evaluate(async () => (await fetch("/api/workhub/secondary-journeys", { credentials: "same-origin" })).status);
  expect(deniedStatus).toBe(403);

  await changeIdentity(page, "sora");
  section = page.locator("#workhub-secondary-journeys");
  pc = section.locator(".workhub-secondary-item").filter({ hasText: "PCを交換したい" }).first();
  await expect(pc).toContainText("1/4ステップ");
  await pc.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(pc).toContainText("2/4ステップ");
  await pc.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(pc).toHaveCount(0); // Corporate no longer assigned; employee receives final task.

  await changeIdentity(page, "aoi");
  section = page.locator("#workhub-secondary-journeys");
  pc = section.locator(".workhub-secondary-item").filter({ hasText: "PCを交換したい" }).first();
  await expect(pc).toContainText("3/4ステップ");
  await pc.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(pc).toContainText("デモ完了");
  await expect(pc).toContainText("4/4ステップ");
});

test("390px journey prevents actions during partial read failure and recovers stale updates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let rejectReads = true;
  await page.route("**/api/workhub/secondary-journeys", async route => {
    if (route.request().method() !== "GET" || !rejectReads) {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await login(page, "aoi");
  const section = page.locator("#workhub-secondary-journeys");
  await expect(section.getByRole("alert")).toContainText("進捗を取得できませんでした");
  await expect(section.getByRole("button", { name: "引っ越し手続きをデモ開始" })).toBeDisabled();
  await expect(section.getByRole("button", { name: "PC交換をデモ依頼" })).toBeDisabled();
  await expect(section).toHaveAttribute("tabindex", "-1");

  rejectReads = false;
  await section.getByRole("button", { name: "最新状態を確認" }).click();
  await expect(section.getByRole("button", { name: "引っ越し手続きをデモ開始" })).toBeEnabled();
  await section.getByRole("button", { name: "引っ越し手続きをデモ開始" }).click();
  const moving = section.locator(".workhub-secondary-item").filter({ hasText: "引っ越した" }).first();
  await expect(moving).toContainText("0/3ステップ");
  await expect(moving.getByRole("list", { name: "引っ越したの手続き進捗" })).toBeVisible();

  // A separate client completes this work item before the old on-screen form
  // submits. The UI must not replay an old approval or display success.
  const externalStatus = await page.evaluate(async () => {
    const current = await fetch("/api/workhub/secondary-journeys", { credentials: "same-origin" })
      .then(response => response.json()) as {
        items: { id: string; intent: string; version: number; workItemVersion: number | null }[]
      };
    const item = current.items.find(entry => entry.intent === "moving" && entry.workItemVersion !== null);
    if (!item) throw new Error("moving item not found");
    const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin" })
      .then(response => response.json()) as { csrfToken: string };
    const reply = await fetch(`/api/workhub/secondary-journeys/${item.id}/advance`, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf.csrfToken },
      body: JSON.stringify({
        expectedVersion: item.version, expectedWorkItemVersion: item.workItemVersion,
      }),
    });
    return reply.status;
  });
  expect(externalStatus).toBe(200);
  await moving.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(section.getByRole("alert")).toContainText("手続きの状態が変更されています");
  await section.getByRole("button", { name: "最新状態を確認" }).click();
  await expect(section.locator(".workhub-secondary-item").filter({ hasText: "引っ越した" }).first())
    .toContainText("1/3ステップ");
});
