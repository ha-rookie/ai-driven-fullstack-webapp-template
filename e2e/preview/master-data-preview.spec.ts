import { expect, test, type Page } from "@playwright/test";
import { WORKHUB_DEMO_PASSWORD } from "../../src/reference/workhub/personas";

const masterListUrl = "/api/admin/master-data?scopeId=workhub-company&masterKey=workhub.office";

const loginAs = async (page: Page, user: "Aoi Employee" | "Kai Admin") => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: new RegExp(user, "u") }).click();
  await page.getByLabel("パスワード", { exact: true }).fill(WORKHUB_DEMO_PASSWORD);

  const loginResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
};

test("master administration fails closed for ordinary employee", async ({ page }) => {
  await loginAs(page, "Aoi Employee");
  const status = await page.evaluate(async (url) => (await fetch(url)).status, masterListUrl);
  expect(status).toBe(403);
  await page.goto("/admin");
  await expect(page.getByText("この領域を表示する権限がありません")).toBeVisible();
});

test("system administrator sees scoped office master and revision history", async ({ page }) => {
  await loginAs(page, "Kai Admin");
  const listResponse = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }, masterListUrl);
  expect(listResponse.status).toBe(200);
  const list = listResponse.body as {
    readonly items: readonly { readonly id: string; readonly code: string }[];
    readonly hasMore: boolean;
    readonly limit: number;
  };
  expect(list.limit).toBe(50);
  expect(list.items.some((item) => item.code === "TOKYO")).toBe(true);

  const tokyo = list.items.find((item) => item.code === "TOKYO");
  expect(tokyo?.id).toBeTruthy();
  const details = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }, masterListUrl + "&itemId=" + encodeURIComponent(tokyo!.id));
  expect(details.status).toBe(200);
  const detail = details.body as {
    readonly item: { readonly code: string };
    readonly revisions: readonly { readonly label: string; readonly lifecycle: string }[];
  };
  expect(detail.item.code).toBe("TOKYO");
  expect(detail.revisions.some((revision) => revision.label === "Tokyo Office" && revision.lifecycle === "current")).toBe(true);

  await page.goto("/admin", { waitUntil: "networkidle" });
  const panel = page.locator("#admin-master-data");
  await expect(panel.getByRole("heading", { name: "マスタ管理（参照）" })).toBeVisible();
  await panel.getByLabel("マスタ項目").selectOption(tokyo!.id);
  await expect(panel.getByText("Tokyo Office", { exact: true })).toBeVisible();
  await expect(panel.getByText("current", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /登録|更新|削除|廃止/u })).toHaveCount(0);
});
