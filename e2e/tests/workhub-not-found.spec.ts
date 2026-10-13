import { expect, test } from "@playwright/test";

test("unknown WORKHUB URL offers safe navigation without querying credentials or business APIs", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) apiRequests.push(pathname);
  });

  await page.goto("/workhub/unknown-request?resource=private-resource");
  const heading = page.getByRole("heading", { level: 1, name: "ページが見つかりません" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText("このページは、少し席を外しているようです。")).toBeVisible();
  const illustration = page.getByRole("img", { name: /席を外したページを探す/u });
  await expect(illustration).toBeVisible();
  await expect(illustration).toHaveAttribute("src", "/images/workhub/not-found-desk.svg");
  await expect.poll(async () => illustration.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
  )).toBe(true);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByText("private-resource")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "WORKHUBホームへ戻る" })).toHaveAttribute("href", "/");
  expect(apiRequests, "404 must not discover the current user or fetch protected data").toEqual([]);

  await page.getByRole("link", { name: "WORKHUBホームへ戻る" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/");
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
});

test("unknown admin subpath is a keyboard-accessible 404 on mobile, not the administration portal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/private-record?token=should-not-appear");
  await expect(page.getByRole("heading", { level: 1, name: "ページが見つかりません" })).toBeFocused();
  await expect(page.getByText("should-not-appear")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "管理できている状態を、ひとつの入口から" })).toHaveCount(0);

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "WORKHUBホームへ戻る" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Showcaseを見る" })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await expect(page.getByRole("img", { name: /席を外したページを探す/u })).toBeVisible();
});

test("the recovery actions still work when the decorative 404 illustration is unavailable", async ({ page }) => {
  await page.route("**/images/workhub/not-found-desk.svg", route => route.abort());
  await page.goto("/unavailable-illustration");
  await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  await expect(page.locator(".workhub-not-found-illustration")).toBeHidden();
  await expect(page.getByRole("link", { name: "WORKHUBホームへ戻る" })).toBeVisible();
  await page.getByRole("link", { name: "WORKHUBホームへ戻る" }).click();
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
});
