import { expect, test } from "@playwright/test";

test("390px travel form stays readable and short submitted request prints on exactly one A4 page", async ({ page }, info) => {
  // PDF printing uses Chromium. Run once against locally seeded Reference D1;
  // never point this mutating scenario at shared Preview.
  test.skip(info.project.name !== "desktop-chromium", "local Chromium print and 390px viewport only");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();

  const formCard = page.locator("#workhub-travel-form");
  await expect(formCard).toBeVisible();
  for (const label of ["行先", "開始日", "終了日", "目的"]) {
    const field = formCard.getByLabel(label, { exact: true }).locator("..");
    await expect(field).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(field).toHaveCSS("font-size", "14px");
  }
  // Supplementary context must not regress to the old pale 10px copy.
  await expect(page.locator(".workhub-reference-note").first()).toHaveCSS("font-size", "12px");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "mobile viewport must have no horizontal overflow").toBeLessThanOrEqual(1);

  const purpose = "A4印刷レイアウト確認 " + Date.now();
  await formCard.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await formCard.getByLabel("開始日").fill("2026-10-20");
  await formCard.getByLabel("終了日").fill("2026-10-21");
  await formCard.getByLabel("目的", { exact: true }).fill(purpose);
  await formCard.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "申請内容を印刷・PDF保存" })).toBeVisible();

  await page.emulateMedia({ media: "print" });
  const sheet = page.locator(".workhub-travel-print-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "出張申請書（現在の申請内容）" })).toBeVisible();
  await expect(sheet).toContainText(purpose);
  await expect(sheet).toContainText("正式な承認証跡");
  await expect(page.locator(".workhub-home-shell")).toHaveCSS("min-height", "0px");
  await expect(page.locator(".workhub-home-header")).toBeHidden();
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  // Chromium's uncompressed page dictionaries use /Type /Page (not /Pages).
  const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/gu) ?? []).length;
  expect(pageCount, "one-page Reference printout must not add a blank second sheet").toBe(1);
});
