import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, userId: "sora" | "aoi") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(userId);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: userId === "sora" ? /Sora/u : /Aoi/u })).toBeVisible();
};

test("General Affairs publishes a company announcement; employees read but cannot publish", async ({ page }, testInfo) => {
  const title = `社内お知らせ E2E ${testInfo.project.name} ${Date.now()}`;
  const body = "全社員へ：明日の朝会は10時からです。\n会議室は第2会議室です。";

  await login(page, "sora");
  const section = page.locator("#workhub-announcements");
  await expect(section.getByRole("heading", { name: "社内お知らせ" })).toBeVisible();
  await section.getByLabel("お知らせの件名").fill(title);
  await section.getByLabel("お知らせの本文").fill(body);
  await section.getByRole("button", { name: "お知らせを公開", exact: true }).click();
  await expect(page.getByText("社内お知らせを公開しました。", { exact: true })).toBeVisible();
  const item = section.locator(".workhub-announcement-item").filter({ hasText: title });
  await expect(item).toContainText(body);

  await page.context().clearCookies();
  await login(page, "aoi");
  const employeeSection = page.locator("#workhub-announcements");
  await expect(employeeSection.locator(".workhub-announcement-item").filter({ hasText: title })).toContainText(body);
  await expect(employeeSection.getByRole("button", { name: "お知らせを公開", exact: true })).toHaveCount(0);

  // Direct API calls remain forbidden even when the UI has no publisher form.
  const attempt = await page.evaluate(async () => {
    const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    const payload = await csrf.json() as { csrfToken: string };
    const response = await fetch("/api/workhub/announcements", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": payload.csrfToken },
      body: JSON.stringify({ title: "forged employee announcement", body: "must be rejected" }),
    });
    return response.status;
  });
  expect(attempt).toBe(403);
  await page.reload();
  await expect(page.locator("#workhub-announcements .workhub-announcement-item").filter({ hasText: title })).toBeVisible();
});
