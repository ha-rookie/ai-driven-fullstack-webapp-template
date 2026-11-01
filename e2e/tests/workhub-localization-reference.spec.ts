import { expect, test } from "@playwright/test";

test.use({ locale: "ja-JP" });

test("#289 locale preview changes only the reference UI, keeping auth, route, dirty form and network budget", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();

  const panel = page.locator("#workhub-locale-reference");
  const language = page.locator("#workhub-language-choice");
  await expect(language).toBeEnabled();
  const purpose = page.getByRole("textbox", { name: "目的", exact: true });
  await expect(purpose).toBeVisible();
  await purpose.fill("draft-must-survive-i18n-switch");
  const originalUrl = page.url();
  let preferenceRequests = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/me/preferences") preferenceRequests += 1;
  });

  await language.selectOption("en-US");
  await expect(panel).toHaveAttribute("lang", "en-US");
  await expect(panel.getByRole("heading", { name: "Localization example" })).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Display language" })).toBeVisible();
  await expect(panel.getByText("English display")).toBeVisible();
  await expect(purpose).toHaveValue("draft-must-survive-i18n-switch");
  await expect(page.getByRole("heading", { name: "おはようございます、Aoi Employeeさん" })).toBeVisible();
  await expect(page.locator(".workhub-home-hero-copy")).toHaveAttribute("lang", "ja-JP");
  expect(page.url()).toBe(originalUrl);

  await panel.getByText("Validation example (not a real request error)").click();
  await expect(panel.getByRole("alert")).toContainText("Check your input.");
  await expect(panel.getByRole("alert")).not.toContainText("private backend message");
  await language.selectOption("ja-JP");
  await expect(panel).toHaveAttribute("lang", "ja-JP");
  await expect(panel.getByRole("combobox", { name: "表示言語" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "おはようございます、Aoi Employeeさん" })).toBeVisible();
  await expect(purpose).toHaveValue("draft-must-survive-i18n-switch");
  expect(page.url()).toBe(originalUrl);
  expect(preferenceRequests).toBe(0);
});

test("#289 saved locale switches Home without re-login or draft loss; #49/#60 regression", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const panel = page.locator("#workhub-locale-reference");
  const select = panel.locator("#workhub-language-choice");
  const purpose = page.getByRole("textbox", { name: "目的", exact: true });
  await expect(select).toBeEnabled();
  await purpose.fill("unsaved-trip-must-survive");
  const originalUrl = page.url();
  await page.waitForLoadState("networkidle");

  const requests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/me/preferences")
      requests.push(request.method() + " " + url.pathname);
    if (request.method() !== "GET" && url.pathname.startsWith("/api/workhub/"))
      requests.push("UNEXPECTED_BUSINESS_MUTATION " + url.pathname);
  });

  // #49: keyboard focus and text alternatives; native select remains labeled.
  await select.focus();
  await expect(select).toBeFocused();
  await select.selectOption("en-US");
  await expect(panel.getByRole("combobox", { name: "Display language" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "おはようございます、Aoi Employeeさん" })).toBeVisible();
  await expect(page.locator(".workhub-home-hero-copy")).toHaveAttribute("lang", "ja-JP");
  await expect(purpose).toHaveValue("unsaved-trip-must-survive");
  expect(page.url()).toBe(originalUrl);
  expect(requests).toEqual([]); // #60: no extra data fetch, page navigation or business mutation on preview.

  // Existing #288 CSRF/versioned save; no new locale store or route reset.
  const saved = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/me/preferences" && response.request().method() === "PATCH");
  await panel.getByRole("button", { name: "Save language preference" }).click();
  expect((await saved).status()).toBe(200);
  await expect(panel.getByRole("status")).toHaveText("Saved");
  await expect(page.getByRole("heading", { name: "Good morning, Aoi Employee" })).toBeVisible();
  await expect(purpose).toHaveValue("unsaved-trip-must-survive");
  expect(page.url()).toBe(originalUrl);
  expect(requests).toEqual(["PATCH /api/me/preferences"]); // #60: exactly one approved preference write.

  await page.reload(); // re-GET from persisted server state; still authenticated.
  await expect(select).toBeEnabled();
  await expect(select).toHaveValue("en-US");
  await expect(page.getByRole("heading", { name: "Good morning, Aoi Employee" })).toBeVisible();
  await expect(page.locator(".workhub-home-hero-copy")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toHaveCount(0);
  expect(page.url()).toBe(originalUrl);

  // Restore local Aoi fixture so other browser scenarios are deterministic.
  await select.selectOption("ja-JP");
  const restored = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/me/preferences" && response.request().method() === "PATCH");
  await panel.getByRole("button", { name: "言語設定を保存" }).click();
  expect((await restored).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "おはようございます、Aoi Employeeさん" })).toBeVisible();
  expect(requests.filter(value => value.startsWith("UNEXPECTED_BUSINESS_MUTATION"))).toEqual([]);
});
