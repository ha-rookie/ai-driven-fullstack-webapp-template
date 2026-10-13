import { expect, test } from "@playwright/test";

test.describe("Japanese guide", () => {
  test.use({ locale: "ja-JP" });
test("Stage6 guide maps architecture, capabilities and a real scenario back to screen source at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();
  const mutations: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD"].includes(request.method())) mutations.push(request.method() + " " + new URL(request.url()).pathname);
  });
  const entry = page.getByRole("button", { name: "Developer Mode — この画面の実装情報" });
  await entry.click();
  const panel = page.getByRole("dialog", { name: "Developer Mode" });
  await panel.getByRole("button", { name: "全体ガイド" }).click();
  const overview = panel.locator(".workhub-developer-overview");
  await expect(overview.getByRole("heading", { name: "Architecture Map" })).toBeVisible();
  await expect(overview).toContainText("Business Domain / Workflow");
  await expect(overview).toContainText("表示用");
  await expect(overview.getByRole("heading", { name: "Capability Map" })).toBeVisible();
  await expect(overview).toContainText("Human Workflow");
  await expect(overview.getByRole("heading", { name: "Scenario Catalog" })).toBeVisible();
  await overview.getByRole("combobox", { name: "Scenario Catalog" }).selectOption("ai-access-request");
  await expect(overview).toContainText("構想・ガイド例のみ");
  await expect(overview).toContainText("このガイドに連動する完成済み");
  await overview.getByRole("combobox", { name: "Scenario Catalog" }).selectOption("travel-request-settlement");
  await expect(overview).toContainText("Reference実装の導線あり");
  await overview.locator(".workhub-developer-scenario").getByRole("button", { name: /この画面の詳細を開く: 出張申請・手続き/u }).click();
  await expect(panel).toContainText("travel-request-settlement");
  await expect(panel).toContainText("Travel Request Domain");
  await panel.getByRole("button", { name: "全体ガイド" }).click();
  await expect(overview.getByRole("link", { name: "初めての方へ：画面からソースまで追う手順" }))
    .toHaveAttribute("href", /WORKHUB_DEVELOPER_GUIDE\.md$/u);
  expect(mutations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(entry).toBeFocused();
});
});

test.describe("English guide", () => {
  test.use({ locale: "en-US" });
test("Stage6 overview works in en-US without changing technical stable IDs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("ren");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Ren Managerさん/u })).toBeVisible();
  await page.getByRole("button", { name: "Developer Mode — この画面の実装情報" }).click();
  const dialog = page.getByRole("dialog", { name: "Developer Mode" });
  await dialog.getByRole("button", { name: "Full guide" }).click();
  await expect(dialog.getByRole("heading", { name: "Architecture Map" })).toBeVisible();
  await expect(dialog).toContainText("Business Domain / Workflow");
  await dialog.getByRole("combobox", { name: "Scenario Catalog" }).selectOption("common-find");
  await expect(dialog).toContainText("Linked Reference journey");
  await dialog.locator(".workhub-developer-scenario").getByRole("button", { name: /Open screen reference: Search/u }).click();
  await expect(dialog).toContainText("common.find");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

});
