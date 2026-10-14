import { expect, test } from "@playwright/test";

test("#350 authenticated WORKHUB session expiry returns to login; 403 does not", async ({ page }) => {
  await page.goto("/");
  // Ordinary initial login must not be labeled as an expired session.
  await expect(page.getByText("セッションの有効期限が切れたか", { exact: false })).toHaveCount(0);
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Aoi Employeeさん/u })).toBeVisible();

  // An authorization denial with a still-valid session is not session expiry.
  await page.route("**/api/workhub/announcements", route => route.fulfill({
    status: 403, contentType: "application/json",
    body: JSON.stringify({ error: { code: "forbidden", message: "forbidden" } }),
  }));
  const refresh = page.getByRole("button", { name: "お知らせを更新" });
  await refresh.click();
  await expect(page.locator("#workhub-announcements").getByRole("alert")).toContainText("お知らせを読み込めませんでした");
  await expect(page.getByRole("heading", { name: /Aoi Employeeさん/u })).toBeVisible();
  await page.unroute("**/api/workhub/announcements");

  // Invalidating the browser cookie is equivalent to server rejection at the
  // API boundary; 401 is verified through the real /api/auth/me server route.
  let businessMutations = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/workhub/")
      && !["GET", "HEAD", "OPTIONS"].includes(request.method())) businessMutations++;
  });
  await page.context().clearCookies();
  await refresh.click();

  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("セッションの有効期限が切れたか");
  await expect(page.getByRole("alert")).toContainText("自動で再送信されません");
  await expect(page.locator("#workhub-travel-form")).toHaveCount(0);
  expect(businessMutations, "401 recovery must not resend business mutations").toBe(0);

  // After an explicit login, the expired-session notice must disappear.
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Aoi Employeeさん/u })).toBeVisible();
  await expect(page.getByText("セッションの有効期限が切れたか", { exact: false })).toHaveCount(0);
});

test("#350 expired session on CSRF preflight does not submit a business mutation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Aoi Employeeさん/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "出張申請を提出" })).toBeVisible();

  let unsafeBusinessRequests = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/workhub/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      unsafeBusinessRequests += 1;
    }
  });

  await page.context().clearCookies();
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("セッションの有効期限が切れたか");
  expect(unsafeBusinessRequests, "a failed CSRF GET must prevent sending the business POST").toBe(0);
});
