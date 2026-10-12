import { expect, test } from "@playwright/test";

test("Stage3 people directory is server-scoped, exposes only demo labels, and recovers on 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const unauth = await page.request.get("/api/workhub/people");
  expect(unauth.status()).toBe(401);

  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();

  const people = page.getByRole("region", { name: "社員・組織" });
  const navigation = page.getByRole("navigation", { name: "WORKHUB メインナビゲーション" });
  await navigation.getByRole("link", { name: "組織・人" }).click();
  await expect(people).toBeInViewport();
  await expect(people.getByRole("heading", { level: 3 })).toHaveCount(6);
  await expect(people.getByRole("heading", { level: 3, name: "Ren Manager" })).toBeVisible();
  await expect(people.getByText("CECIL WORKS株式会社（デモ）").first()).toBeVisible();
  await expect(people).toContainText("実際の人事情報・連絡先ではありません");

  const api = await page.request.get("/api/workhub/people");
  expect(api.status()).toBe(200);
  const data = await api.json() as { items: Array<Record<string, unknown>> };
  expect(data.items).toHaveLength(6);
  for (const item of data.items) {
    expect(Object.keys(item).sort()).toEqual(["displayName", "organizationLabel", "roleLabel"]);
  }
  expect(JSON.stringify(data)).not.toMatch(/workhub-demo-|Workhub-Demo-2026!|email|phone|userId|internalUserId/iu);

  // The previous successful list must disappear on a read error. It is not
  // trustworthy to show cached people data as though the new read succeeded.
  await page.route("**/api/workhub/people", route => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":{"message":"unavailable"}}',
  }));
  await people.getByRole("button", { name: "社員一覧を更新" }).click();
  await expect(people.getByRole("alert")).toContainText("0件とは限りません");
  await expect(people.getByRole("heading", { level: 3 })).toHaveCount(0);

  await page.unroute("**/api/workhub/people");
  await people.getByRole("button", { name: "再読み込み" }).click();
  await expect(people.getByRole("heading", { level: 3 })).toHaveCount(6);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
