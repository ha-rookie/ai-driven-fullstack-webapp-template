import { expect, test, type Page } from "@playwright/test";

/**
 * Remote Preview authentication acceptance: only session login/logout is mutable.
 * Does NOT submit travel requests, retry jobs, restore data, seed fixtures, or
 * capture authenticated screenshots/traces with session credentials.
 */
const previewOrigin = "https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev";

const choosePersonaAndLogin = async (page: Page, personaName: string, headingName: RegExp) => {
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  const dialog = page.getByRole("dialog", { name: "デモユーザを選ぶ" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: new RegExp(personaName, "u") }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: headingName })).toBeVisible();
  await expect.poll(async () => await page.evaluate(async () =>
    (await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })).status,
  )).toBe(200);
};

const switchUserAndVerifyRevocation = async (page: Page) => {
  const switchButton = page.getByRole("button", {
    name: "ログアウトして別のユーザーでログイン",
  });
  await expect(switchButton).toBeVisible();
  await expect(switchButton).toContainText("ユーザー切替");
  await switchButton.click();
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await expect(page).toHaveURL(previewOrigin + "/");
  await expect.poll(async () => await page.evaluate(async () =>
    (await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })).status,
  )).toBe(401);
};

test.beforeEach(async ({ page }) => {
  const forbiddenWrites: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    const method = req.method();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;
    if (url.origin !== previewOrigin
        || !["/api/auth/login", "/api/auth/logout"].includes(url.pathname)
        || method !== "POST") {
      forbiddenWrites.push(method + " " + url.pathname);
    }
  });
  // A required assertion is registered after test body as well, even on failure.
  (page as Page & { __forbiddenWrites?: string[] }).__forbiddenWrites = forbiddenWrites;
});

test.afterEach(async ({ page }) => {
  const writes = (page as Page & { __forbiddenWrites?: string[] }).__forbiddenWrites ?? [];
  expect(writes, "Preview must not change business data or invoke admin mutations").toEqual([]);
});

test("Preview Aoi → server logout → Ren → server logout, with no business mutations", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).origin).toBe(previewOrigin);
  await expect(page.getByText("Reference Demo", { exact: true })).toBeVisible();

  await choosePersonaAndLogin(page, "Aoi Employee", /おはようございます、Aoi Employeeさん/u);
  await switchUserAndVerifyRevocation(page);
  await expect(page.getByRole("textbox", { name: "ユーザーID", exact: true })).toHaveValue("");

  await choosePersonaAndLogin(page, "Ren Manager", /おはようございます、Ren Managerさん/u);
  await switchUserAndVerifyRevocation(page);
});

test("Preview Kai System Admin can switch users from administration header", async ({ page }) => {
  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  await expect(page.getByText("Reference Demo", { exact: true })).toBeVisible();

  await choosePersonaAndLogin(page, "Kai Admin", /おはようございます、Kai Adminさん/u);
  await page.goto("/admin", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "管理できている状態を、ひとつの入口から" }))
    .toBeVisible();

  await switchUserAndVerifyRevocation(page);
});
