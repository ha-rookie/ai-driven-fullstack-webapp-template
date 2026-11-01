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
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  expect(page.url()).toBe(originalUrl);

  await panel.getByText("Validation example (not a real request error)").click();
  await expect(panel.getByRole("alert")).toContainText("Check your input.");
  await expect(panel.getByRole("alert")).not.toContainText("private backend message");
  await language.selectOption("ja-JP");
  await expect(panel).toHaveAttribute("lang", "ja-JP");
  await expect(panel.getByRole("combobox", { name: "表示言語" })).toBeVisible();
  await expect(purpose).toHaveValue("draft-must-survive-i18n-switch");
  expect(page.url()).toBe(originalUrl);
  expect(preferenceRequests).toBe(0);
});
