import { expect, test } from "@playwright/test";

const PREVIEW_ORIGIN = "https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev";

/**
 * Safe to dispatch independently of Preview fixture/operation acceptance:
 * public Showcase GET only; no demo login, sessions, data mutations or private screenshots.
 */
test("public WORKHUB Showcase opens at pinned Preview origin on desktop and mobile", async ({ page }, testInfo) => {
  const unexpected: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== PREVIEW_ORIGIN || !["GET", "HEAD", "OPTIONS"].includes(request.method())
      || url.pathname.startsWith("/api/")) {
      unexpected.push(request.method() + " " + url.origin + url.pathname);
    }
  });

  const response = await page.goto("/showcase", { waitUntil: "networkidle" });
  expect(response?.status(), "Preview /showcase response").toBe(200);
  expect(new URL(page.url()).origin, "fixed Preview host only").toBe(PREVIEW_ORIGIN);
  await expect(page.getByRole("heading", { level: 1, name: /業務システムを/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: /実際の画面では、/u })).toBeVisible();
  await expect(page.getByRole("link", { name: "WORKHUBを試す ↗" })).toHaveAttribute("href", "/");

  const tour = page.locator("#showcase-tour");
  await tour.getByRole("button", { name: "次へ →" }).click();
  await expect(tour).toContainText("上長が差し戻し、社員が再申請する");
  await tour.getByRole("button", { name: "次へ →" }).click();
  await tour.getByRole("button", { name: "次へ →" }).click();
  await expect(tour).toContainText("検索・帳票も、現在の権限で確認する");
  await expect(page.locator(".showcase-status-grid")).toContainText("NOT IMPLEMENTED");

  const overflow = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(overflow.content, "no horizontal overflow in target viewport")
    .toBeLessThanOrEqual(overflow.viewport + 1);

  await page.screenshot({
    path: testInfo.outputPath(`preview-showcase-${testInfo.project.name}.png`),
    fullPage: true, animations: "disabled",
  });
  expect(unexpected, "public Showcase must remain read-only, same-origin, API-free").toEqual([]);
});
