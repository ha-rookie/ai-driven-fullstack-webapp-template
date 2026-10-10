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

  // #475 / #572: make sure the NEW deployed picker actually works on Preview.
  // Public-only UI, no login and no business mutations; both projects run this.
  await page.getByRole("link", { name: "必要な部品だけ探す →" }).click();
  await expect(page).toHaveURL(/#showcase-reuse$/u);
  const picker = page.getByRole("group", { name: "持ち帰りたいテーマを選ぶ" });
  const detail = page.getByRole("region", { name: "選択した再利用テーマ" });

  await expect(picker.getByRole("button", { name: /申請・承認を作る/u }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(detail.getByRole("link", { name: /Recipeを読む/u }))
    .toHaveAttribute("href", /\/docs\/recipes\/REFERENCE_TRAVEL_REQUEST\.md$/u);
  await expect(detail.getByRole("link", { name: /実装を読む/u }))
    .toHaveAttribute("href", /\/src\/reference\/workhub\/travel-request\/service\.ts$/u);
  await expect(detail.getByRole("link", { name: /検証を見る/u }))
    .toHaveAttribute("href", /\/e2e\/tests\/workhub-travel-request\.spec\.ts$/u);

  await picker.getByRole("button", { name: /権限制御を組み込む/u }).click();
  await expect(picker.getByRole("button", { name: /権限制御を組み込む/u }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(detail).toContainText("現在の所属と対象Scope");
  await expect(detail.getByRole("link", { name: /実装を読む/u }))
    .toHaveAttribute("href", /\/src\/worker\/authorization\/policy\.ts$/u);
  await expect(detail.getByRole("link", { name: /検証方針を読む/u }))
    .toHaveAttribute("href", /\/docs\/BOUNDARY_TESTING\.md$/u);

  await picker.getByRole("button", { name: /障害・運用を考える/u }).click();
  await expect(picker.getByRole("button", { name: /障害・運用を考える/u }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(detail).toContainText("外部SaaSの受領実照合");
  await expect(detail.getByRole("link", { name: /Recipeを読む/u }))
    .toHaveAttribute("href", /\/docs\/recipes\/INTEGRATION_EVENT_OUTBOX_RECIPE\.md$/u);
  await expect(detail.getByRole("link", { name: /関連E2Eを見る/u }))
    .toHaveAttribute("href", /\/e2e\/tests\/workhub-operations-overview\.spec\.ts$/u);

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
