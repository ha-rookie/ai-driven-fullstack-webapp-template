import { expect, test } from "@playwright/test";

const demoPassword = "Workhub-Demo-2026!";
const invalidPassword = "incorrect-password-value";
const personas = [
  ["haru", "Haru Newcomer"],
  ["aoi", "Aoi Employee"],
  ["ren", "Ren Manager"],
  ["mei", "Mei Accounting"],
  ["sora", "Sora Corporate"],
  ["kai", "Kai Admin"],
] as const;

test("WORKHUB login exposes the reference-only persona selector and performs real authentication", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await expect(page.getByText("Reference Demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "デモユーザを選ぶ" })).toBeVisible();
  await expect(page.getByRole("button", { name: /シングルサインオン/u })).toHaveCount(0);

  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  const dialog = page.getByRole("dialog", { name: "デモユーザを選ぶ" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Aoi Employee/u }).click();

  await expect(page.getByRole("textbox", { name: "ユーザーID", exact: true })).toHaveValue("aoi");
  await expect(page.getByLabel("パスワード", { exact: true })).not.toHaveValue("");
  await page.getByRole("checkbox", { name: /ログイン情報を保持する/u }).check();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  await expect(page.getByText("REQUESTS / 出張したい", { exact: true })).toBeVisible();
  await expect(page.getByText("NOTIFICATIONS", { exact: true })).toBeVisible();

  await expect.poll(() => page.evaluate(() => localStorage.getItem("workhub.rememberedUserId"))).toBe("aoi");
});

test("all six WORKHUB personas can authenticate through the server-side credential path", async ({ request }) => {
  for (const [userId] of personas) {
    const response = await request.post("/api/auth/login", {
      data: { userId, password: demoPassword, remember: false },
      headers: { "content-type": "application/json" },
    });
    expect(response.status(), `${userId} should authenticate`).toBe(200);
    const payload = await response.json() as { authenticated?: boolean; user?: { id?: string } };
    expect(payload.authenticated).toBe(true);
    expect(payload.user?.id).toBe(`workhub-demo-${userId}`);
  }
});

test("invalid credential uses a generic error and does not reveal account existence", async ({ request }) => {
  const known = await request.post("/api/auth/login", {
    data: { userId: "aoi", password: invalidPassword, remember: false },
  });
  const unknown = await request.post("/api/auth/login", {
    data: { userId: "not-a-workhub-user", password: invalidPassword, remember: false },
  });

  expect(known.status()).toBe(401);
  expect(unknown.status()).toBe(401);
  const knownBody = await known.json() as { error?: { code?: string; message?: string } };
  const unknownBody = await unknown.json() as { error?: { code?: string; message?: string } };
  expect(knownBody.error).toEqual(unknownBody.error);
  expect(knownBody.error).toEqual({
    code: "authentication_failed",
    message: "User ID or password is incorrect",
  });
});

test("switch user revokes server session and logs in as another Persona", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("checkbox", { name: /ログイン情報を保持する/u }).check();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "ログアウトして別のユーザーでログイン" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("workhub.rememberedUserId"))).toBe("aoi");

  await page.getByRole("button", { name: "ログアウトして別のユーザーでログイン" }).click();
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "ユーザーID", exact: true })).toHaveValue("");
  await expect.poll(async () => (await page.request.get("/api/auth/me")).status()).toBe(401);

  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Ren Manager/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Ren Managerさん/u })).toBeVisible();
  await expect.poll(async () => (await page.request.get("/api/auth/me")).status()).toBe(200);
});

test("system admin can switch users from the admin portal header", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Kai Admin/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Kai Adminさん/u })).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "管理できている状態を、ひとつの入口から" })).toBeVisible();
  await page.getByRole("button", { name: "ログアウトして別のユーザーでログイン" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/");
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await expect.poll(async () => (await page.request.get("/api/auth/me")).status()).toBe(401);
});

test("failed logout keeps current identity and offers safe retry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();

  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  const switchButton = page.getByRole("button", { name: "ログアウトして別のユーザーでログイン" });
  await switchButton.click();
  await expect(page.getByRole("alert")).toContainText("ログアウトできませんでした");
  await expect(switchButton).toBeEnabled();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  await expect.poll(async () => (await page.request.get("/api/auth/me")).status()).toBe(200);
});
