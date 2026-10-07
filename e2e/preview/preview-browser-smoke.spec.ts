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
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const loginResponse = await loginResponsePromise;
  const loginBody = await loginResponse.text();
  console.log("Preview Aoi login evidence", {
    status: loginResponse.status(),
    requestId: loginResponse.headers()["x-request-id"] ?? null,
    body: loginBody,
  });
  expect(loginResponse.status(), loginBody).toBe(200);

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


test("fixed Preview administration portal renders for System Admin without mutation", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  const dialog = page.getByRole("dialog", { name: "デモユーザを選ぶ" });
  await dialog.getByRole("button", { name: /Kai Admin/u }).click();
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const loginResponse = await loginResponsePromise;
  const loginBody = await loginResponse.text();
  console.log("Preview Kai login evidence", {
    status: loginResponse.status(),
    requestId: loginResponse.headers()["x-request-id"] ?? null,
    body: loginBody,
  });
  expect(loginResponse.status(), loginBody).toBe(200);
  await expect(page.getByText("CECIL WORKS DIGITAL WORKPLACE", { exact: true })).toBeVisible();

  const response = await page.goto("/admin", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "管理できている状態を、ひとつの入口から" })).toBeVisible();
  await expect(page.getByText("OPERATIONS / ADMINISTRATION", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "管理ポータル" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ユーザー・権限" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ジョブ・連携" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "監査・セキュリティ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "危険な操作ほど、理由と確認を残す" })).toBeVisible();
  await expect(page.getByRole("button", { name: "安全操作の接続点" })).toBeDisabled();

  await page.screenshot({
    path: testInfo.outputPath(`preview-admin-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
