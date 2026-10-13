import { expect, test } from "@playwright/test";

test.use({ locale: "ja-JP" });

test("Stage6 Screen Catalog correctly maps four implemented WORKHUB sections, safe Source links and mock boundary", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();

  const mutations: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      mutations.push(request.method() + " " + new URL(request.url()).pathname);
    }
  });

  const entry = page.getByRole("button", { name: "Developer Mode — この画面の実装情報" });
  for (const [fragment, id, sourceFile] of [
    ["#workhub-expenses", "expenses", "src/reference/workhub/ExpenseWorkspace.tsx"],
    ["#workhub-announcements", "announcements", "src/reference/workhub/announcements.ts"],
    ["#workhub-social", "social", "src/reference/workhub/social.ts"],
    ["#workhub-secondary-journeys", "secondary-journeys", "src/reference/workhub/secondary-journeys.ts"],
  ] as const) {
    await page.evaluate(hash => { window.location.hash = hash; }, fragment);
    await entry.click();
    const panel = page.getByRole("dialog", { name: "Developer Mode" });
    await expect(panel).toContainText(`workhub.${id}`);
    await expect(panel.getByRole("link", { name: sourceFile })).toHaveAttribute("href", /github.com\/ha-rookie\/ai-driven-fullstack-webapp-template\/blob\/main/u);
    if (id === "secondary-journeys") {
      await expect(panel).toContainText("模擬連携");
      await expect(panel).toContainText("mock-adapter");
      await panel.getByRole("button", { name: "全体ガイド" }).click();
      await expect(panel.getByRole("heading", { name: "Screen Catalog" })).toBeVisible();
      await expect(panel.getByRole("heading", { name: "Adapter / Integration Map" })).toBeVisible();
      await expect(panel).toContainText("Mock moving steps");
      await panel.getByRole("combobox", { name: "Scenario Catalog" }).selectOption("pc-replacement-reference");
      await expect(panel).toContainText("模擬Workflowのみ");
    }
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(entry).toBeFocused();
  }
  expect(mutations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
