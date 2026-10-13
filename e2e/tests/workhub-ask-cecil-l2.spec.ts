import { expect, test } from "@playwright/test";

test("Ask CECIL L2 prepares but never creates/submits a travel request", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();

  const unexpectedMutations: string[] = [];
  page.on("request", request => {
    if (/\/api\/workhub\/travel-requests(?:\/|$)/u.test(new URL(request.url()).pathname) &&
      !["GET", "HEAD"].includes(request.method())) unexpectedMutations.push(request.method());
  });

  await page.getByRole("button", { name: "Ask CECIL" }).click();
  const dialog = page.getByRole("dialog", { name: "Ask CECIL" });
  await dialog.getByRole("button", { name: "出張について" }).click();
  await expect(dialog.getByRole("button", { name: "出張申請の下書きを準備する" })).toBeVisible();
  await dialog.getByRole("button", { name: "出張申請の下書きを準備する" }).click();
  const card = dialog.getByRole("region", { name: "出張申請の下書き" });
  await expect(card.getByRole("combobox", { name: "下書きの出張先" })).toBeVisible();
  await card.getByRole("button", { name: "申請画面で確認する" }).click();
  await expect(card.getByRole("alert")).toContainText("出張先");
  await card.getByRole("combobox", { name: "下書きの出張先" }).selectOption({ index: 1 });
  await card.getByRole("textbox", { name: "下書きの開始日" }).fill("2026-10-20");
  await card.getByRole("textbox", { name: "下書きの終了日" }).fill("2026-10-19");
  await card.getByRole("textbox", { name: "下書きの目的" }).fill("顧客訪問");
  await card.getByRole("button", { name: "申請画面で確認する" }).click();
  await expect(card.getByRole("alert")).toContainText("終了日");
  await card.getByRole("textbox", { name: "下書きの終了日" }).fill("2026-10-21");

  const officeId = await card.getByRole("combobox", { name: "下書きの出張先" }).inputValue();
  await card.getByRole("button", { name: "申請画面で確認する" }).click();
  await expect(dialog).toHaveCount(0);
  const form = page.locator("#workhub-travel-form");
  await expect(form.getByRole("status")).toContainText("まだ保存・提出されていません");
  await expect(form.getByRole("combobox", { name: "行先" })).toHaveValue(officeId);
  await expect(form.getByRole("textbox", { name: "開始日" })).toHaveValue("2026-10-20");
  await expect(form.getByRole("textbox", { name: "終了日" })).toHaveValue("2026-10-21");
  await expect(form.getByRole("textbox", { name: "目的" })).toHaveValue("顧客訪問");
  expect(unexpectedMutations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("Ask CECIL L2 never appears to a persona without authorized travel-request app", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("ren");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Ren Managerさん/u })).toBeVisible();
  await page.getByRole("button", { name: "Ask CECIL" }).click();
  const dialog = page.getByRole("dialog", { name: "Ask CECIL" });
  await dialog.getByRole("button", { name: "出張について" }).click();
  await expect(dialog.getByRole("button", { name: "出張申請の下書きを準備する" })).toHaveCount(0);
  await expect(dialog.getByRole("region", { name: "出張申請の下書き" })).toHaveCount(0);
});
