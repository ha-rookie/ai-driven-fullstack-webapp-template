import { expect, test } from "@playwright/test";

test("#290 saved theme + OS system switch preserves WORKHUB session, draft and request budget", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
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
