import { expect, test } from "@playwright/test";

test("#290 saved theme + OS system switch preserves WORKHUB session, draft and request budget", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  // #290 Slice B: login uses the current OS signal, never the previous user's theme.
  const loginSurface = page.locator(".workhub-theme-scope");
  await expect(loginSurface).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".workhub-login-card h2")).toHaveCSS("color", "rgb(238, 244, 248)");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const panel = page.locator("#workhub-theme-reference");
  const choice = panel.getByRole("combobox", { name: "表示テーマ" });
  const surface = page.locator(".workhub-theme-scope");
  const purpose = page.getByRole("textbox", { name: "目的", exact: true });
  await expect(choice).toBeEnabled();
  const originalSelection = await choice.inputValue();
  const originalUrl = page.url();
  await purpose.fill("unsaved-business-draft-290");

  const calls: string[] = [];
  page.on("request", req => {
    const path = new URL(req.url()).pathname;
    if (path === "/api/me/preferences") calls.push(req.method() + " " + path);
    if (req.method() !== "GET" && path.startsWith("/api/workhub/"))
      calls.push("UNEXPECTED BUSINESS MUTATION " + path);
  });

  await choice.selectOption("dark");
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(panel.getByRole("status")).toContainText("未保存のプレビュー");
  await expect(purpose).toHaveValue("unsaved-business-draft-290");
  expect(calls).toEqual([]);
  expect(page.url()).toBe(originalUrl);

  const firstSave = page.waitForResponse(res =>
    new URL(res.url()).pathname === "/api/me/preferences" && res.request().method() === "PATCH");
  await panel.getByRole("button", { name: "表示設定を保存" }).click();
  expect((await firstSave).status()).toBe(200);
  await expect(panel.getByRole("status")).toHaveText("表示設定を保存しました");
  await expect(surface).toHaveAttribute("data-theme-source", "user");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(surface).toHaveAttribute("data-theme", "dark");

  await choice.selectOption("system");
  await expect(surface).toHaveAttribute("data-theme-mode", "system");
  await expect(surface).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(surface).toHaveAttribute("data-theme", "dark");
  const systemSave = page.waitForResponse(res =>
    new URL(res.url()).pathname === "/api/me/preferences" && res.request().method() === "PATCH");
  await panel.getByRole("button", { name: "表示設定を保存" }).click();
  expect((await systemSave).status()).toBe(200);
  expect(calls).toEqual(["PATCH /api/me/preferences", "PATCH /api/me/preferences"]);
  await expect(purpose).toHaveValue("unsaved-business-draft-290");
  expect(page.url()).toBe(originalUrl);

  await page.reload();
  await expect(choice).toBeEnabled();
  await expect(choice).toHaveValue("system");
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toHaveCount(0);

  // Restore the original saved preference for the remaining shared browser scenarios.
  if (originalSelection !== "system") {
    await choice.selectOption(originalSelection);
    const restore = page.waitForResponse(res =>
      new URL(res.url()).pathname === "/api/me/preferences" && res.request().method() === "PATCH");
    await panel.getByRole("button", { name: "表示設定を保存" }).click();
    expect((await restore).status()).toBe(200);
  }
  expect(calls.some(call => call.startsWith("UNEXPECTED BUSINESS MUTATION"))).toBe(false);
});


test("#290 bootstrap waits for the server theme before mounting protected UI and clears it on logout", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  // Synthetic only: no persisted test-user changes, no extra API or custom storage.
  let releasePreference!: () => void;
  const preferenceGate = new Promise<void>(resolve => { releasePreference = resolve; });
  const preferenceMethods: string[] = [];
  await page.route("**/api/me/preferences", async route => {
    const method = route.request().method();
    preferenceMethods.push(method);
    if (method !== "GET") return route.continue();
    await preferenceGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, version: 4, values: { theme: "light" } }),
    });
  });

  await page.goto("/");
  const surface = page.locator(".workhub-theme-scope");
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.locator(".workhub-loading")).toContainText("表示設定を確認しています…");
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".workhub-home-shell")).toHaveCount(0);
  await expect(page.locator("#workhub-travel-form")).toHaveCount(0);
  expect(preferenceMethods).toContain("GET");
  expect(preferenceMethods).not.toContain("PATCH");

  releasePreference();
  await expect(surface).toHaveAttribute("data-theme", "light");
  await expect(surface).toHaveAttribute("data-theme-source", "user");
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  expect(preferenceMethods).not.toContain("PATCH");

  await page.getByRole("button", { name: "ログアウトして別のユーザーでログイン" }).click();
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(surface).not.toHaveAttribute("data-theme-source", "user");
  await expect(page.locator(".workhub-login-card h2")).toHaveCSS("color", "rgb(238, 244, 248)");

  // A new identity is not served the prior user's synthetic preferences.
  await page.unroute("**/api/me/preferences");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Ren Manager/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Ren Managerさん/u })).toBeVisible();
  expect(preferenceMethods).not.toContain("PATCH");
});

test("#290 unavailable preference GET retains authentication and safely recovers without business mutation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const methods: string[] = [];
  await page.route("**/api/me/preferences", async route => {
    methods.push(route.request().method());
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const warning = page.locator(".workhub-preferences-fallback");
  const surface = page.locator(".workhub-theme-scope");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("表示設定を取得できませんでした");
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(surface).not.toHaveAttribute("data-theme-source", "user");
  await expect(page.getByRole("heading", { name: "ログイン状態を確認できません" })).toHaveCount(0);
  expect(methods).not.toContain("PATCH");

  await page.unroute("**/api/me/preferences");
  await warning.getByRole("button", { name: "表示設定を再読み込み" }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.locator("#workhub-theme-reference")
    .getByRole("combobox", { name: "表示テーマ" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  expect(methods).not.toContain("PATCH");
});
