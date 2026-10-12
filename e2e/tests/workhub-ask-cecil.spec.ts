import { expect, test } from "@playwright/test";

test("Stage5 Ask CECIL L0/L1 uses current authorized evidence, degrades safely, and works on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();

  const trigger = page.getByRole("button", { name: "Ask CECIL" });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Ask CECIL" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "質問・探していること" })).toBeFocused();
  await panel.getByRole("button", { name: "出張について" }).click();
  await expect(panel.getByText("出張の申請から経費申請までのReference業務フロー。")).toBeVisible();
  await expect(panel.getByRole("region", { name: "根拠となる文書" })).toContainText("出張と経費精算の手順（デモ）");
  await expect(panel.getByRole("region", { name: "根拠となる文書" })).toContainText("v3");
  await expect(panel.getByRole("region", { name: "根拠となる文書" })).toContainText("2026-10-05");
  await expect(panel).not.toContainText("管理者向けインシデント対応");

  const query = panel.getByRole("textbox", { name: "質問・探していること" });
  await query.fill("インシデント");
  await panel.getByRole("button", { name: "探す", exact: true }).click();
  await expect(panel.getByText(/確認できる根拠が見つかりませんでした/u)).toBeVisible();
  await expect(panel).not.toContainText("管理者向けインシデント対応");

  await page.route("**/api/workhub/search?**", route => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":{"message":"unavailable"}}',
  }));
  await query.fill("出張");
  await panel.getByRole("button", { name: "探す", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("0件とは限りません");
  await expect(panel.getByRole("region", { name: "根拠となる文書" })).toHaveCount(0);
  await page.unroute("**/api/workhub/search?**");
  await panel.getByRole("button", { name: "再試行" }).click();
  await expect(panel.getByText("出張の申請から経費申請までのReference業務フロー。")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
