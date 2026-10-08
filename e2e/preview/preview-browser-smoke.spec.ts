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
  const loginStatus = loginResponse.status();
  console.log("Preview Aoi login status", {
    status: loginStatus,
    requestId: loginResponse.headers()["x-request-id"] ?? null,
    dependencyStage: loginResponse.headers()["x-auth-dependency-stage"] ?? null,
    dependencyDetail: loginResponse.headers()["x-auth-dependency-detail"] ?? null,
  });
  const loginBody = loginStatus === 200 ? "" : await loginResponse.text();
  console.log("Preview Aoi login evidence", {
    status: loginStatus,
    requestId: loginResponse.headers()["x-request-id"] ?? null,
    dependencyStage: loginResponse.headers()["x-auth-dependency-stage"] ?? null,
    dependencyDetail: loginResponse.headers()["x-auth-dependency-detail"] ?? null,
    body: loginBody,
  });
  expect(loginStatus, loginBody).toBe(200);

  const unauthorizedAuditStatus = await page.evaluate(async () =>
    (await fetch("/api/admin/audit?scopeId=workhub-company&limit=20")).status,
  );
  expect(unauthorizedAuditStatus).toBe(403);

  const unauthorizedJobsStatus = await page.evaluate(async () =>
    (await fetch("/api/admin/jobs?scopeId=workhub-company&limit=20")).status,
  );
  expect(unauthorizedJobsStatus).toBe(403);

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
  const loginStatus = loginResponse.status();
  console.log("Preview Kai login status", {
    status: loginStatus,
    requestId: loginResponse.headers()["x-request-id"] ?? null,
    dependencyStage: loginResponse.headers()["x-auth-dependency-stage"] ?? null,
    dependencyDetail: loginResponse.headers()["x-auth-dependency-detail"] ?? null,
  });
  const loginBody = loginStatus === 200 ? "" : await loginResponse.text();
  console.log("Preview Kai login evidence", {
    status: loginStatus,
    requestId: loginResponse.headers()["x-request-id"] ?? null,
    dependencyStage: loginResponse.headers()["x-auth-dependency-stage"] ?? null,
    dependencyDetail: loginResponse.headers()["x-auth-dependency-detail"] ?? null,
    body: loginBody,
  });
  expect(loginStatus, loginBody).toBe(200);
  await expect(page.getByText("CECIL WORKS DIGITAL WORKPLACE", { exact: true })).toBeVisible();

  const auditResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/admin/audit?") && response.request().method() === "GET",
  );
  const jobsResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/admin/jobs?") && response.request().method() === "GET",
  );
  const response = await page.goto("/admin", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  const [auditResponse, jobsResponse] = await Promise.all([auditResponsePromise, jobsResponsePromise]);
  expect(auditResponse.status()).toBe(200);
  expect(jobsResponse.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "管理できている状態を、ひとつの入口から" })).toBeVisible();
  await expect(page.getByText("OPERATIONS / ADMINISTRATION", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "管理ポータル" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ユーザー・権限" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ジョブ・連携" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "監査・セキュリティ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ジョブ運用" })).toBeVisible();
  await expect(page.getByText("ジョブ状態を取得できませんでした")).toHaveCount(0);

  const recoveryJobRow = page.getByRole("row").filter({ hasText: "workhub-demo-search-recovery-job" });
  if (await recoveryJobRow.count()) {
    const completed = recoveryJobRow.getByText("completed", { exact: true });
    if (await completed.count()) {
      await expect(completed).toBeVisible();
    } else {
      const retryButton = recoveryJobRow.getByRole("button", { name: "再実行を確認" });
      if (await retryButton.count()) {
        await recoveryJobRow.scrollIntoViewIfNeeded();
        await retryButton.click({ force: true });
        const retryPanel = page.locator(".admin-retry-panel");
        await retryPanel.getByLabel("再実行理由").fill("Preview acceptance: search dependency recovered");
        await retryPanel.getByLabel("対象・環境・影響範囲を確認しました").check();
        const retryResponsePromise = page.waitForResponse(
          (retryResponse) =>
            retryResponse.url().includes("/api/admin/jobs/workhub-demo-search-recovery-job/retry?")
            && retryResponse.request().method() === "POST",
        );
        await retryPanel.getByRole("button", { name: "このJobを再実行" }).click();
        const retryResponse = await retryResponsePromise;
        expect([200, 409]).toContain(retryResponse.status());
        if (retryResponse.status() === 200) {
          await expect(page.getByText("再実行と検証が完了しました")).toBeVisible();
        } else {
          await page.reload({ waitUntil: "networkidle" });
          await expect(
            page.getByRole("row").filter({ hasText: "workhub-demo-search-recovery-job" }).getByText("completed", { exact: true }),
          ).toBeVisible();
        }
      }
    }
  }

  await expect(page.getByRole("heading", { name: "監査ログ" })).toBeVisible();
  await expect(page.getByText("監査ログを取得できませんでした")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "危険な操作ほど、理由と確認を残す" })).toBeVisible();
  await expect(page.getByRole("button", { name: "安全操作の接続点" })).toBeDisabled();

  await page.screenshot({
    path: testInfo.outputPath(`preview-admin-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
