import { expect, test, type Page } from "@playwright/test";

const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();
};

test("Stage5 Escalate prepares a non-sending human note with only refreshed evidence and a real directory route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const writes: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method() + " " + new URL(request.url()).pathname);
  });
  await page.getByRole("button", { name: "Ask CECIL" }).click();
  const panel = page.getByRole("dialog", { name: "Ask CECIL" });
  await panel.getByRole("button", { name: "出張について" }).click();
  await expect(panel.getByRole("region", { name: "根拠となる文書" })).toContainText("出張と経費精算の手順");
  const escalation = panel.getByRole("region", { name: "担当者への相談準備" });
  await escalation.getByRole("button", { name: "問い合わせ用メモを作る" }).click();
  const note = escalation.getByRole("textbox", { name: "問い合わせ用メモ（選択してコピーできます）" });
  await expect(note).toHaveValue(new RegExp("出張", "u"));
  await expect(note).toHaveValue(new RegExp("v3", "u"));
  await expect(note).toHaveValue(new RegExp("送信されていません", "u"));
  await expect(escalation).toContainText("会話・申請・個人情報は自動転送されません");
  expect(writes).toEqual([]);
  await escalation.getByRole("link", { name: "社員・組織一覧で担当者を探す" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/#workhub-people$/u);
  await expect(page.locator("#workhub-people")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("Escalate after failed fresh authorized documents lookup sends no source or data", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Ask CECIL" }).click();
  const panel = page.getByRole("dialog", { name: "Ask CECIL" });
  await panel.getByRole("button", { name: "出張について" }).click();
  await expect(panel.getByRole("region", { name: "根拠となる文書" })).toBeVisible();
  await page.route("**/api/workhub/documents", route => route.fulfill({
    status: 403, contentType: "application/json", body: '{"error":"forbidden"}',
  }));
  const escalation = panel.getByRole("region", { name: "担当者への相談準備" });
  await escalation.getByRole("button", { name: "問い合わせ用メモを作る" }).click();
  const note = escalation.getByRole("textbox", { name: "問い合わせ用メモ（選択してコピーできます）" });
  await expect(note).toHaveValue(new RegExp("現時点で確認できた出典は添付していません", "u"));
  await expect(note).not.toHaveValue(new RegExp("出張と経費精算の手順", "u"));
  await page.unroute("**/api/workhub/documents");
});

test("Insufficient evidence and unavailable search offer usable inquiry preparation, not fabricated answers", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Ask CECIL" }).click();
  const panel = page.getByRole("dialog", { name: "Ask CECIL" });
  const query = panel.getByRole("textbox", { name: "質問・探していること" });
  await query.fill("インシデント");
  await panel.getByRole("button", { name: "探す", exact: true }).click();
  await expect(panel.getByText(/確認できる根拠が見つかりませんでした/u)).toBeVisible();
  const escalation = panel.getByRole("region", { name: "担当者への相談準備" });
  await escalation.getByRole("button", { name: "問い合わせ用メモを作る" }).click();
  await expect(escalation.getByRole("textbox", { name: "問い合わせ用メモ（選択してコピーできます）" })).toHaveValue(new RegExp("根拠が不足", "u"));
  await page.route("**/api/workhub/search?**", route => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":"temporarily unavailable"}',
  }));
  await query.fill("出張");
  await panel.getByRole("button", { name: "探す", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("0件とは限りません");
  await escalation.getByRole("button", { name: "問い合わせ用メモを作る" }).click();
  const note = escalation.getByRole("textbox", { name: "問い合わせ用メモ（選択してコピーできます）" });
  await expect(note).toHaveValue(new RegExp("検索を利用できません", "u"));
  await expect(note).not.toHaveValue(new RegExp("出張と経費精算の手順", "u"));
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask CECIL" })).toBeFocused();
});
