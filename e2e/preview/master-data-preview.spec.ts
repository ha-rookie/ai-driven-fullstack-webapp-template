import { expect, test, type Page } from "@playwright/test";
import { WORKHUB_DEMO_PASSWORD } from "../../src/reference/workhub/personas";

const masterListUrl = "/api/admin/master-data?scopeId=workhub-company&masterKey=workhub.office";

const loginAs = async (page: Page, user: "Aoi Employee" | "Kai Admin") => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: new RegExp(user, "u") }).click();
  await page.getByLabel("パスワード", { exact: true }).fill(WORKHUB_DEMO_PASSWORD);

  const loginResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
};

test("master administration fails closed for ordinary employee", async ({ page }) => {
  await loginAs(page, "Aoi Employee");
  const status = await page.evaluate(async (url) => (await fetch(url)).status, masterListUrl);
  expect(status).toBe(403);
  await page.goto("/admin");
  await expect(page.getByText("この領域を表示する権限がありません")).toBeVisible();
});

test("system administrator sees scoped office master and revision history", async ({ page }) => {
  await loginAs(page, "Kai Admin");
  const listResponse = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }, masterListUrl);
  expect(listResponse.status).toBe(200);
  const list = listResponse.body as {
    readonly items: readonly { readonly id: string; readonly code: string }[];
    readonly hasMore: boolean;
    readonly limit: number;
  };
  expect(list.limit).toBe(50);
  expect(list.items.some((item) => item.code === "TOKYO")).toBe(true);

  const tokyo = list.items.find((item) => item.code === "TOKYO");
  expect(tokyo?.id).toBeTruthy();
  const details = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }, masterListUrl + "&itemId=" + encodeURIComponent(tokyo!.id));
  expect(details.status).toBe(200);
  const detail = details.body as {
    readonly item: { readonly code: string };
    readonly revisions: readonly { readonly label: string; readonly lifecycle: string }[];
  };
  expect(detail.item.code).toBe("TOKYO");
  expect(detail.revisions.some((revision) => revision.label === "Tokyo Office" && revision.lifecycle === "current")).toBe(true);

  await page.goto("/admin", { waitUntil: "networkidle" });
  const panel = page.locator("#admin-master-data");
  await expect(panel.getByRole("heading", { name: "マスタ管理（参照）" })).toBeVisible();
  await panel.getByLabel("マスタ項目").selectOption(tokyo!.id);
  await expect(panel.getByText("Tokyo Office", { exact: true })).toBeVisible();
  await expect(panel.getByText("current", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /登録|更新|削除|廃止/u })).toHaveCount(0);
});

test("ordinary employee cannot preview a privileged master retirement", async ({ page }) => {
  await loginAs(page, "Aoi Employee");
  const result = await page.evaluate(async () =>
    (await fetch("/api/admin/master-operations/retire/preview?scopeId=workhub-company&itemId=workhub-office-legacy&expectedVersion=2")).status,
  );
  expect(result).toBe(403);
});

test("admin can retire only the isolated Preview master with verified post-state", async ({ page }) => {
  await loginAs(page, "Kai Admin");
  await page.goto("/admin", { waitUntil: "networkidle" });
  const panel = page.locator("#admin-master-retire-demo");
  await expect(panel.getByRole("heading", { name: "拠点マスタ廃止（専用デモ）" })).toBeVisible();
  await expect(panel.getByText("RETIRE_MASTER_ITEM", { exact: true })).toBeVisible();
  const retired = panel.getByTestId("master-retired-state");
  const initialState = await retired.textContent();
  if (initialState?.includes("NO")) {
    await panel.getByLabel("廃止理由").fill("Preview acceptance: obsolete demo office should not be selected");
    await panel.getByLabel("LEGACY拠点・環境・変更の影響を確認しました").check();
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/admin/master-operations/retire/execute?") &&
      response.request().method() === "POST",
    );
    await panel.getByRole("button", { name: "デモ拠点を廃止" }).click();
    const response = await responsePromise;
    expect([200, 409]).toContain(response.status());
    if (response.status() === 200) {
      const body = await response.json() as {
        readonly execution: { readonly result: string };
        readonly verification: { readonly status: string };
      };
      expect(body.execution.result).toBe("SUCCESS");
      expect(body.verification.status).toBe("PASSED");
      await expect(panel.getByText("廃止と検証が完了しました")).toBeVisible();
    }
  }
  await expect(retired).toContainText("YES");

  // Retirement keeps the existing historical revision available via the viewer.
  const history = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, body: await response.json() };
  }, masterListUrl + "&itemId=workhub-office-legacy");
  expect(history.status).toBe(200);
  const detail = history.body as {
    readonly item: { readonly retiredAt: string | null };
    readonly revisions: readonly { readonly label: string; readonly lifecycle: string }[];
  };
  expect(detail.item.retiredAt).not.toBeNull();
  expect(detail.revisions.some((revision) => revision.label === "Retire demo office" && revision.lifecycle === "retired")).toBe(true);
  const wrongTarget = await page.evaluate(async () =>
    (await fetch("/api/admin/master-operations/retire/preview?scopeId=workhub-company&itemId=workhub-office-tokyo&expectedVersion=2")).status,
  );
  expect(wrongTarget).toBe(404);
});

test("ordinary employee cannot preview a future master cutover", async ({ page }) => {
  await loginAs(page, "Aoi Employee");
  const response = await page.evaluate(async () =>
    (await fetch("/api/admin/master-operations/schedule/preview?scopeId=workhub-company&itemId=workhub-office-schedule&expectedVersion=2&effectiveFrom=2027-04-01T00%3A00%3A00.000Z&label=New")).status,
  );
  expect(response).toBe(403);
});

test("admin schedules future revision atomically without breaking prior history", async ({ page }) => {
  await loginAs(page, "Kai Admin");
  await page.goto("/admin", { waitUntil: "networkidle" });
  const panel = page.locator("#admin-master-schedule-demo");
  await expect(panel.getByRole("heading", { name: "マスタの将来改訂（専用デモ）" })).toBeVisible();
  await expect(panel.getByText("SCHEDULE_MASTER_REVISION", { exact: true })).toBeVisible();
  const history = panel.getByTestId("master-schedule-history");
  const priorCount = await history.textContent();
  if (priorCount?.includes("1 Revision")) {
    await panel.getByRole("button", { name: "切替内容を下見" }).click();
    await expect(panel.getByText("CONTROLLED_CHANGE")).toBeVisible();
    await panel.getByLabel("変更理由").fill("Preview cutover acceptance: next fiscal year label");
    await panel.getByLabel("現行期間の終了・将来改訂の開始日時・過去履歴の保持を確認しました").check();
    const pendingResponse = page.waitForResponse((response) =>
      response.url().includes("/api/admin/master-operations/schedule/execute?") &&
      response.request().method() === "POST",
    );
    await panel.getByRole("button", { name: "将来改訂を予約" }).click();
    const executed = await pendingResponse;
    expect(executed.status()).toBe(200);
    const outcome = await executed.json() as {
      readonly execution: { readonly result: string };
      readonly verification: { readonly status: string };
    };
    expect(outcome.execution.result).toBe("SUCCESS");
    expect(outcome.verification.status).toBe("PASSED");
    await expect(panel.getByText("将来Revisionの予約と切替前後の検証が完了しました")).toBeVisible();
  }
  await expect(history).toHaveText("2 Revision");
  const detail = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, data: await response.json() };
  }, masterListUrl + "&itemId=workhub-office-schedule");
  expect(detail.status).toBe(200);
  const record = detail.data as {
    readonly revisions: readonly {
      readonly label: string;
      readonly effectiveTo: string | null;
      readonly effectiveFrom: string;
      readonly lifecycle: string;
    }[];
  };
  const original = record.revisions.find((revision) => revision.label === "Scheduled Office Original");
  const future = record.revisions.find((revision) => revision.label === "Scheduled Office Next");
  expect(original?.effectiveTo).toBe("2027-04-01T00:00:00.000Z");
  expect(future?.effectiveFrom).toBe("2027-04-01T00:00:00.000Z");
  expect(future?.effectiveTo).toBeNull();
  expect(future?.lifecycle).toBe("future");

  // TOKYO is never an allowed mutation target.
  const wrongTarget = await page.evaluate(async () =>
    (await fetch("/api/admin/master-operations/schedule/preview?scopeId=workhub-company&itemId=workhub-office-tokyo&expectedVersion=2&effectiveFrom=2027-04-01T00%3A00%3A00.000Z&label=Wrong")).status,
  );
  expect(wrongTarget).toBe(404);
});
