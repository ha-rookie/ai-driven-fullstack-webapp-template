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
