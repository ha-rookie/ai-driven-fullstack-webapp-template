import { expect, test, type Page } from "@playwright/test";

const signInAsAoi = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();
};

const prepareAskCecilDraft = async (page: Page) => {
  await page.getByRole("button", { name: "Ask CECIL" }).click();
  const dialog = page.getByRole("dialog", { name: "Ask CECIL" });
  await dialog.getByRole("button", { name: "出張について" }).click();
  await dialog.getByRole("button", { name: "出張申請の下書きを準備する" }).click();
  const draft = dialog.getByRole("region", { name: "出張申請の下書き" });
  await expect(draft.getByRole("combobox", { name: "下書きの出張先" })).toBeVisible();
  await draft.getByRole("combobox", { name: "下書きの出張先" }).selectOption({ index: 1 });
  await draft.getByLabel("下書きの開始日").fill("2026-10-20");
  await draft.getByLabel("下書きの終了日").fill("2026-10-21");
  await draft.getByRole("textbox", { name: "下書きの目的" }).fill("顧客への提案説明");
  await draft.getByRole("button", { name: "申請画面で確認する" }).click();
  await expect(dialog).toHaveCount(0);
};

test("L3 requires distinct human confirmation; cancel/edit never sends a POST, confirm uses existing workflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsAoi(page);
  let created = 0;
  let submitted = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "POST") return;
    if (path === "/api/workhub/travel-requests") ++created;
    if (/^\/api\/workhub\/travel-requests\/[^/]+\/submit$/u.test(path)) ++submitted;
  });
  await prepareAskCecilDraft(page);
  const form = page.locator("#workhub-travel-form");
  await expect(form.getByRole("button", { name: "提出前に内容を確認" })).toBeVisible();
  expect({ created, submitted }).toEqual({ created: 0, submitted: 0 });

  await form.getByRole("button", { name: "提出前に内容を確認" }).click();
  const review = form.getByRole("region", { name: "出張申請を提出する前の最終確認" });
  await expect(review).toContainText("Aoi Employee");
  await expect(review).toContainText("上長へ承認を依頼");
  await expect(review).toContainText("顧客への提案説明");
  await expect(review).toContainText("2026-10-20");
  await expect(review).toContainText("自動承認はしません");
  expect({ created, submitted }).toEqual({ created: 0, submitted: 0 });

  await review.getByRole("button", { name: "編集に戻る" }).click();
  await expect(review).toHaveCount(0);
  expect({ created, submitted }).toEqual({ created: 0, submitted: 0 });
  await form.getByRole("button", { name: "提出前に内容を確認" }).click();
  await expect(review).toBeVisible();

  await form.getByRole("textbox", { name: "目的" }).fill("顧客との調整ミーティング");
  await expect(review).toHaveCount(0);
  expect({ created, submitted }).toEqual({ created: 0, submitted: 0 });
  await form.getByRole("button", { name: "提出前に内容を確認" }).click();
  await expect(review).toContainText("顧客との調整ミーティング");
  await review.getByRole("button", { name: "確認して出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。")).toBeVisible();
  expect({ created, submitted }).toEqual({ created: 1, submitted: 1 });
  await expect(form.getByRole("button", { name: "出張申請を提出", exact: true })).toBeVisible();
  await expect(review).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("L3 aborts before business writes when current application permission is revoked", async ({ page }) => {
  await signInAsAoi(page);
  let mutationCount = 0;
  page.on("request", request => {
    if (request.method() !== "GET" && /\/api\/workhub\/travel-requests/u.test(new URL(request.url()).pathname)) mutationCount++;
  });
  await prepareAskCecilDraft(page);
  const form = page.locator("#workhub-travel-form");
  await form.getByRole("button", { name: "提出前に内容を確認" }).click();
  const review = form.getByRole("region", { name: "出張申請を提出する前の最終確認" });
  await expect(review).toBeVisible();
  await page.route("**/api/workhub/apps", route => route.fulfill({
    status: 200, contentType: "application/json", body: '{"items":[]}',
  }));
  await review.getByRole("button", { name: "確認して出張申請を提出" }).click();
  await expect(page.getByText(/出張申請の権限または出張先が更新されています/u)).toBeVisible();
  expect(mutationCount).toBe(0);
  await page.unroute("**/api/workhub/apps");
  await expect(review).toBeVisible();
});
