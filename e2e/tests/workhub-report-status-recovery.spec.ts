import { expect, test } from "@playwright/test";

// Local WORKHUB fixture only. No Preview business mutations. The report status
// is injected into an already owner-authorized travel detail GET.
test("#350 approved travel report failure remains secondary and recovers via GET only on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Aoi Employeeさん/u })).toBeVisible();

  const purpose = "帳票障害復旧 E2E " + Date.now();
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("開始日").fill("2026-10-20");
  await page.getByLabel("終了日").fill("2026-10-21");
  await page.getByLabel("目的", { exact: true }).fill(purpose);
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();

  let state: "failed" | "ready" = "failed";
  let reads = 0;
  let businessPosts = 0;
  page.on("request", request => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/workhub/")) businessPosts++;
  });
  await page.route(/\/api\/workhub\/travel-requests\/[^/]+$/u, async route => {
    reads++;
    const response = await route.fetch();
    if (!response.ok) return route.fulfill({ response });
    const original = await response.json() as Record<string, unknown>;
    const request = original.request as { id: string; workflowInstanceId: string };
    return route.fulfill({
      response,
      contentType: "application/json",
      body: JSON.stringify({ ...original,
        workflow: { id: request.workflowInstanceId, resourceType: "workhub.travel_request",
          resourceId: request.id, state: "completed", version: 1 },
        reportStatus: { state },
      }),
    });
  });

  await page.locator(".workhub-my-requests").getByRole("button", { name: new RegExp(purpose, "u") }).click();
  const detail = page.locator("#workhub-request-detail");
  await expect(detail).toContainText("Workflow: completed");
  const report = detail.getByRole("region", { name: "帳票生成状況" });
  await expect(report.getByRole("alert")).toContainText("帳票生成に失敗しました");
  await expect(report).toContainText("承認は完了しています");
  await expect(report.getByRole("button", { name: "帳票状態を再確認（読み取りのみ）" })).toBeVisible();
  await expect(report).not.toContainText("再申請してください");
  expect(businessPosts, "the report status GET must not create another travel or approval POST").toBe(0);

  state = "ready";
  await report.getByRole("button", { name: "帳票状態を再確認（読み取りのみ）" }).click();
  await expect(report.getByRole("status")).toContainText("承認と帳票生成は完了しています");
  await expect(report.getByRole("alert")).toHaveCount(0);
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(businessPosts, "refresh may read but never replay the original business action").toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
