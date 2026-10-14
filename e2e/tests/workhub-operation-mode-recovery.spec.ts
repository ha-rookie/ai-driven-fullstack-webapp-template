import { expect, test } from "@playwright/test";

// #350 H: local fixture only. The Workhub operation-mode backend guard is a
// reusable Foundation primitive, not yet wired to every business route.
// These tests verify how the WORKHUB screen handles explicit guard responses.
const errorScenarios = [
  {
    code: "operation_read_only",
    heading: "読み取り専用モード",
    guidance: "内容の閲覧は続けられます",
  },
  {
    code: "service_in_maintenance",
    heading: "メンテナンス中",
    guidance: "メンテナンス中のため",
  },
  {
    code: "operation_mode_unavailable",
    heading: "運用状態を確認できません",
    guidance: "運用状態を確認できないため",
  },
] as const;

for (const scenario of errorScenarios) {
  test(`${scenario.code} blocks duplicate WORKHUB submit and explains recovery`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let submits = 0;
    await page.route("**/api/workhub/travel-requests", async route => {
      if (route.request().method() !== "POST") return route.continue();
      submits++;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "x-request-id": "workhub-request-350" },
        body: JSON.stringify({ error: { code: scenario.code, message: "sensitive-internal-provider-diagnostics" } }),
      });
    });

    await page.goto("/");
    await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
    await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Aoi Employeeさん/u })).toBeVisible();

    await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
    await page.getByLabel("開始日").fill("2026-10-20");
    await page.getByLabel("終了日").fill("2026-10-21");
    const purpose = "運用モード中でも保持する下書き";
    await page.getByLabel("目的", { exact: true }).fill(purpose);

    const submit = page.getByRole("button", { name: "出張申請を提出" });
    await submit.click();
    const notice = page.getByRole("alert", { name: "業務の運用状態" });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(scenario.heading);
    await expect(notice).toContainText(scenario.guidance);
    await expect(notice).toContainText("この画面からの変更操作は再送信しません");
    const reference = notice.getByRole("textbox", { name: "お問い合わせ時の識別番号" });
    await expect(reference).toHaveValue("workhub-request-350");
    await expect(reference).toHaveAttribute("readonly", "");
    await reference.focus();
    expect(await reference.evaluate((input: HTMLInputElement) => input.selectionStart === 0 && input.selectionEnd === input.value.length)).toBe(true);
    await expect(notice.getByRole("button", { name: "画面を再読み込み" })).toBeVisible();
    await expect(page.getByLabel("目的", { exact: true })).toHaveValue(purpose);
    await expect(submit).toBeDisabled();
    expect(submits, "a guarded refusal must not trigger a second business POST").toBe(1);
    await expect(page.getByText("sensitive-internal-provider-diagnostics")).toHaveCount(0);

    // The representative read-only path remains available for current data:
    // this GET neither replays nor changes the rejected business operation.
    if (scenario.code === "operation_read_only") {
      const status = await page.evaluate(async () =>
        (await fetch("/api/workhub/offices", { credentials: "same-origin" })).status,
      );
      expect(status).toBe(200);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
  });
}

test("an unrelated server error must not masquerade as WORKHUB maintenance", async ({ page }) => {
  await page.route("**/api/workhub/travel-requests", async route => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 503, contentType: "application/json",
      body: '{"error":{"code":"resource_unavailable","message":"Service unavailable"}}',
    });
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Aoi Employeeさん/u })).toBeVisible();
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("開始日").fill("2026-10-20");
  await page.getByLabel("終了日").fill("2026-10-21");
  await page.getByLabel("目的", { exact: true }).fill("通常障害と運用モードの区別");
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Service unavailable" })).toBeVisible();
  await expect(page.getByRole("alert", { name: "業務の運用状態" })).toHaveCount(0);
});
