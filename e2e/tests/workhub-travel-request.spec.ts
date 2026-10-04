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

test("Aoi and Ren complete submit-return-resubmit-approve with notifications and timeline", async ({ page }) => {
  await loginAs(page, "aoi");

  await expect(page.getByText("REQUESTS / 出張したい", { exact: true })).toBeVisible();
  await page.getByLabel("行先").selectOption({ label: /Tokyo Office/u });
  await page.getByLabel("開始日").fill("2026-10-20");
  await page.getByLabel("終了日").fill("2026-10-21");
  await page.getByLabel("目的").fill("東京顧客打ち合わせ E2E");
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
  await expect(page.getByText("申請しました", { exact: true })).toBeVisible();

  await switchPersona(page, "ren");
  await expect(page.getByText("東京顧客打ち合わせ E2E", { exact: true })).toBeVisible();
  await expect(page.getByText("出張申請の承認依頼が届きました", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "差し戻す" }).click();
  await expect(page.getByText("差し戻しました。", { exact: true })).toBeVisible();

  await switchPersona(page, "aoi");
  await expect(page.getByText("出張申請が差し戻されました", { exact: true })).toBeVisible();
  await page.getByText("出張申請が差し戻されました", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "出張申請を修正" })).toBeVisible();
  await expect(page.getByText("差し戻されました", { exact: true })).toBeVisible();
  await page.getByLabel("目的").fill("東京顧客打ち合わせ E2E 修正版");
  await page.getByRole("button", { name: "修正して再申請" }).click();
  await expect(page.getByText("出張申請を再申請しました。", { exact: true })).toBeVisible();
  await expect(page.getByText("再申請しました", { exact: true })).toBeVisible();

  await switchPersona(page, "ren");
  await expect(page.getByText("東京顧客打ち合わせ E2E 修正版", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "承認する" }).click();
  await expect(page.getByText("承認しました。", { exact: true })).toBeVisible();

  await switchPersona(page, "aoi");
  await expect(page.getByText("出張申請が承認されました", { exact: true })).toBeVisible();
  await page.getByText("出張申請が承認されました", { exact: true }).click();
  await expect(page.getByText("Workflow:", { exact: false })).toContainText("completed");
  await expect(page.getByText("申請しました", { exact: true })).toBeVisible();
  await expect(page.getByText("差し戻されました", { exact: true })).toBeVisible();
  await expect(page.getByText("再申請しました", { exact: true })).toBeVisible();
  await expect(page.getByText("承認されました", { exact: true })).toBeVisible();
});
