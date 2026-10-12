import { expect, test, type Page } from "@playwright/test";

const signIn = async (page: Page, user: "aoi" | "sora") => {
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(user, "iu") })).toBeVisible();
};

const beginPc = async (page: Page): Promise<string> => {
  let key = "";
  page.on("request", request => {
    if (request.url().endsWith("/api/workhub/secondary-journeys")
      && request.method() === "POST") {
      const body = request.postDataJSON() as { key?: string; intent?: string };
      if (body.intent === "pc-replacement" && body.key) key = body.key;
    }
  });
  await page.locator("#workhub-secondary-journeys")
    .getByRole("button", { name: "PC交換をデモ依頼" }).click();
  await expect.poll(() => key).not.toBe("");
  let id = "";
  await expect.poll(async () => {
    id = await page.evaluate(async requestKey => {
      const res = await fetch("/api/workhub/secondary-journeys", { credentials: "same-origin" });
      if (!res.ok) return "";
      const data = await res.json() as { items: Array<{ id: string; submissionKey: string }> };
      return data.items.find(x => x.submissionKey.endsWith(requestKey))?.id ?? "";
    }, key);
    return id;
  }).not.toBe("");
  await expect(page.locator(`[data-journey-id="${id}"]`)).toBeVisible();
  return id;
};

test("PC alternative: Corporate requests info and employee resubmits the same workflow", async ({ page }) => {
  test.setTimeout(75_000);
  await signIn(page, "aoi");
  const id = await beginPc(page);
  let card = page.locator(`[data-journey-id="${id}"]`);
  await card.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(card).toContainText("1/4ステップ");

  await signIn(page, "sora");
  card = page.locator(`[data-journey-id="${id}"]`);
  await expect(card.getByRole("button", { name: "追加情報を要求する（デモ）" })).toBeVisible();

  // Current assigned Corporate actor may not use a stale instance version.
  const rejectedStatus = await page.evaluate(async journeyId => {
    const token = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    const { csrfToken } = await token.json() as { csrfToken: string };
    const list = await fetch("/api/workhub/secondary-journeys", { credentials: "same-origin" });
    const data = await list.json() as { items: Array<{ id: string; workItemVersion: number }> };
    const item = data.items.find(x => x.id === journeyId);
    const response = await fetch(`/api/workhub/secondary-journeys/${journeyId}/decision`, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ action: "return", expectedVersion: 0, expectedWorkItemVersion: item?.workItemVersion }),
    });
    return response.status;
  }, id);
  expect(rejectedStatus).toBe(409);

  await card.getByRole("button", { name: "追加情報を要求する（デモ）" }).click();
  await expect(card).toHaveCount(0); // No Corporate open assignment while waiting for employee.

  await signIn(page, "aoi");
  card = page.locator(`[data-journey-id="${id}"]`);
  await expect(card.getByRole("status")).toContainText("追加情報の確認待ち（デモ）");
  await expect(card.getByRole("button", { name: "追加情報を確認したものとしてデモ再提出" })).toBeVisible();
  await card.getByRole("button", { name: "追加情報を確認したものとしてデモ再提出" }).click();
  await expect(card.getByRole("status")).toContainText("デモ進行中");

  await signIn(page, "sora");
  card = page.locator(`[data-journey-id="${id}"]`);
  await expect(card).toContainText("1/4ステップ");
  await expect(card.getByRole("button", { name: "追加情報を要求する（デモ）" })).toBeVisible();
  await card.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(card).toContainText("2/4ステップ");
});

test("PC alternative: Corporate records simulated no-stock rejection, never real inventory", async ({ page }) => {
  test.setTimeout(65_000);
  await signIn(page, "aoi");
  const id = await beginPc(page);
  let card = page.locator(`[data-journey-id="${id}"]`);
  await card.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(card).toContainText("1/4ステップ");

  await signIn(page, "sora");
  card = page.locator(`[data-journey-id="${id}"]`);
  await card.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(card).toContainText("2/4ステップ");
  await card.getByRole("button", { name: "デモ在庫なしとして終了" }).click();
  await expect(card).toHaveCount(0);

  await signIn(page, "aoi");
  card = page.locator(`[data-journey-id="${id}"]`);
  await expect(card.getByRole("status")).toContainText("デモ在庫なし・処理終了");
  await expect(card).toContainText("2/4ステップ");
  await expect(card.locator("li").filter({ hasText: "交換準備" })).toContainText("却下");
  await expect(card).toContainText("実際の端末在庫を確認した結果ではありません");
  await expect(card.getByRole("button", { name: /デモステップを完了する|デモ再提出/u })).toHaveCount(0);
});

test("PC simulated shortage stays processing with mock ETA and resumes only after arrival", async ({ page }) => {
  test.setTimeout(80_000);
  await signIn(page, "aoi");
  const id = await beginPc(page);
  let card = page.locator(`[data-journey-id="${id}"]`);
  await card.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(card).toContainText("1/4ステップ");

  await signIn(page, "sora");
  card = page.locator(`[data-journey-id="${id}"]`);
  await card.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(card).toContainText("2/4ステップ");
  await card.getByRole("button", { name: "デモ在庫不足・入荷待ちを登録" }).click();
  await expect(card).toContainText("デモ入荷待ち・処理中");
  await expect(card).toContainText("参考予定日（実在庫と無関係）");
  await expect(card).toContainText("2/4ステップ");
  await expect(card.getByRole("button", { name: "現在のデモステップを完了する" })).toHaveCount(0);

  // Server-side checks also prevent bypassing the paused processing button.
  const denied = await page.evaluate(async journeyId => {
    const csrfResponse = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
    const response = await fetch("/api/workhub/secondary-journeys", { credentials: "same-origin" });
    const listed = await response.json() as { items: Array<{ id: string; version: number; workItemVersion: number }> };
    const item = listed.items.find(x => x.id === journeyId);
    return fetch(`/api/workhub/secondary-journeys/${journeyId}/advance`, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ expectedVersion: item?.version, expectedWorkItemVersion: item?.workItemVersion }),
    }).then(x => x.status);
  }, id);
  expect(denied).toBe(409); // Business state is invalid while waiting.

  await signIn(page, "aoi");
  card = page.locator(`[data-journey-id="${id}"]`);
  await expect(card).toContainText("デモ入荷待ち・処理中");
  await expect(card).toContainText("2/4ステップ");

  await signIn(page, "sora");
  card = page.locator(`[data-journey-id="${id}"]`);
  await card.getByRole("button", { name: "デモ入荷を確認・処理を再開" }).click();
  await expect(card).toContainText("デモ入荷確認済み・処理再開可能");
  await expect(card).toContainText("2/4ステップ");
  await card.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(card).toHaveCount(0);

  await signIn(page, "aoi");
  card = page.locator(`[data-journey-id="${id}"]`);
  await expect(card).toContainText("3/4ステップ");
  await card.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(card).toContainText("デモ完了");
  await expect(card).toContainText("4/4ステップ");
});
