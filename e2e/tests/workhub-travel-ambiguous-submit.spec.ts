import { expect, test } from "@playwright/test";

test("Stage 2 travel retry checks the existing submission instead of creating a duplicate", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Aoi Employeeさん/u })).toBeVisible();

  let draftsCreated = 0;
  let submissions = 0;
  await page.route("**/api/workhub/travel-requests", async route => {
    if (route.request().method() === "POST") draftsCreated++;
    await route.continue();
  });
  await page.route("**/api/workhub/travel-requests/*/submit", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    submissions++;
    // The server commits successfully, but its HTTP response is lost.
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  const purpose = `提出応答欠落 E2E ${info.project.name} ${Date.now()}`;
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("開始日").fill("2026-10-21");
  await page.getByLabel("終了日").fill("2026-10-22");
  await page.getByLabel("目的", { exact: true }).fill(purpose);
  const submit = page.getByRole("button", { name: "出張申請を提出" });

  await submit.click();
  await expect(page.getByRole("status").filter({ hasText: "Request failed (503)" })).toBeVisible();
  expect(draftsCreated).toBe(1);
  expect(submissions).toBe(1);

  // User explicitly retries. Read-only GET confirms already submitted;
  // there must be no second draft nor duplicate submit command.
  await submit.click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
  expect(draftsCreated).toBe(1);
  expect(submissions).toBe(1);
  await expect(page.locator("#workhub-my-requests .workhub-my-request-item")
    .filter({ hasText: purpose })).toHaveCount(1);
});
