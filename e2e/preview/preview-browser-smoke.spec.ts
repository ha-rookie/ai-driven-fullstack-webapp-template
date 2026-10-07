import { expect, test } from "@playwright/test";

test("fixed Preview WORKHUB login and home shell render without business-data mutation", async ({ page }, testInfo) => {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).origin).toBe("https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev");

  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await expect(page.getByText("Reference Demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "デモユーザを選ぶ" })).toBeVisible();

  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  const dialog = page.getByRole("dialog", { name: "デモユーザを選ぶ" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  await expect(page.getByText("CECIL WORKS DIGITAL WORKPLACE", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日の予定" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "何をしたいですか？" })).toBeVisible();
  await expect(page.getByRole("img", { name: "WORKHUB Digital Workplaceのトップビジュアル" })).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath(`preview-home-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
