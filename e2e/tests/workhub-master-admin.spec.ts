import { expect, test, type Page } from "@playwright/test";

/**
 * UI acceptance only. Login and the actual /admin components are real; isolated
 * Preview-only Master fixtures are mocked for GET routes, since the local E2E
 * seed deliberately contains only WORKHUB's live NAGOYA/TOKYO offices.
 * The first test mocks the POST result as HTTP 409 and never modifies a DB.
 */
const demoPassword = "Workhub-Demo-2026!";
const enableId = "workhub-office-availability-enable";
const disableId = "workhub-office-availability-disable";
const tokyoId = "workhub-office-tokyo";
const scheduleId = "workhub-office-schedule";
const orderId = "workhub-office-order";

const item = (id: string) => ({
  id, code: id === enableId ? "AVAIL_ENABLE" : id === disableId ? "AVAIL_DISABLE" : "TOKYO",
  version: 2, retiredAt: null,
});
const revision = (id: string) => ({
  id: id + "-r1", revision: 1, label: id === enableId ? "Availability demo B" : "Tokyo Office",
  enabled: id !== enableId, effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null, displayOrder: 20, parentItemId: null,
  lifecycle: id === enableId ? "disabled" : "current",
});
const previewResponse = {
  available: true, priorRevisionId: enableId + "-r1",
  policyVersion: "test-policy-1", enabled: true, currentEnabled: false, reasonCode: null,
  preview: { risk: "CONTROLLED_CHANGE", policyDecision: "REQUIRE_REASON" },
};

const logInAndMockReadOnlyMasterData = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("kai");
  await page.getByLabel("パスワード", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Kai Admin/u })).toBeVisible();

  await page.route("**/api/admin/master-data?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("masterKey")).toBe("workhub.office");
    const id = query.get("itemId");
    const body = id
      ? { item: item(id), revisions: [revision(id)], hasMore: false,
          allowedOperations: id === tokyoId ? [] : ["schedule"],
          asOf: "2026-10-10T00:00:00.000Z" }
      : { items: [item(tokyoId), item(disableId), item(enableId), item(scheduleId), item(orderId)],
        hasMore: false, environment: "local", asOf: "2026-10-10T00:00:00.000Z" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/admin");
  const viewer = page.locator("#admin-master-data");
  await expect(viewer.getByRole("heading", { name: "マスタ管理（参照）" })).toBeVisible();
  await expect(viewer.getByLabel("マスタ定義")).toHaveValue("workhub.office");
  await expect(viewer.getByLabel("マスタ定義")).toBeDisabled(); // no unapproved Definition
  await expect(viewer.getByText("TOKYO", { exact: true }).first()).toBeVisible();

  // Ordinary office masters must not acquire a privileged action link.
  await expect(viewer.getByText("この項目に設定された変更操作はありません。参照のみ可能です。")).toBeVisible();
  await viewer.getByLabel("マスタ項目").selectOption(enableId);
  const action = viewer.getByRole("link", { name: /有効・無効切替の下見へ/u });
  await expect(action).toBeVisible();
  await action.click();
  await expect(page).toHaveURL(/#admin-master-availability$/u);

  const panel = page.locator("#admin-master-availability");
  await expect(panel.getByLabel("対象デモ")).toHaveValue(enableId);
  await expect(panel.getByText("AVAIL_ENABLE", { exact: true })).toBeVisible();
  return panel;
};

test("selected master opens the approved operation; HTTP 409 refreshes without retrying POST", async ({ page }) => {
  const panel = await logInAndMockReadOnlyMasterData(page);
  let previews = 0;
  let posts = 0;
  await page.route("**/api/admin/master-operations/schedule/preview?**", async (route) => {
    previews += 1;
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("itemId")).toBe(enableId);
    expect(query.get("enabled")).toBe("true");
    expect(query.get("expectedVersion")).toBe("2");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(previewResponse) });
  });
  await page.route("**/api/admin/master-operations/schedule/execute?**", async (route) => {
    posts += 1;
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ status: 409, contentType: "application/json",
      body: JSON.stringify({ error: { code: "master_state_conflict", message: "Version changed" } }) });
  });

  await panel.getByRole("button", { name: "状態変更を下見" }).click();
  await expect(panel.getByTestId("master-availability-preview")).toContainText("false → true");
  const submit = panel.getByRole("button", { name: "状態変更を予約" });
  await expect(submit).toBeDisabled();
  await panel.getByLabel("状態変更の理由").fill("Browser acceptance conflict rehearsal");
  await panel.getByLabel("新規選択への影響、切替日時、過去履歴の保持を確認しました").check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(panel.getByText(/Versionまたは状態が変更されました/u)).toBeVisible();
  await expect(panel.getByTestId("master-availability-preview")).toHaveCount(0);
  expect(previews).toBe(1);
  expect(posts).toBe(1); // not replayed after 409
});

test("changing the cutover during a delayed preview discards its obsolete response", async ({ page }) => {
  const panel = await logInAndMockReadOnlyMasterData(page);
  let release!: () => void;
  let received!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const arrived = new Promise<void>((resolve) => { received = resolve; });
  let posts = 0;
  await page.route("**/api/admin/master-operations/schedule/preview?**", async (route) => {
    received();
    await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(previewResponse) });
  });
  await page.route("**/api/admin/master-operations/schedule/execute?**", async (route) => {
    posts += 1;
    await route.abort();
  });

  const previewReturned = page.waitForResponse((response) =>
    response.url().includes("/api/admin/master-operations/schedule/preview?"));
  await panel.getByRole("button", { name: "状態変更を下見" }).click();
  await arrived;
  await panel.getByLabel("切替開始日時（ISO UTC）").fill("2027-05-01T00:00:00.000Z");
  release();
  await previewReturned;
  await expect(panel.getByRole("button", { name: "状態変更を下見" })).toBeEnabled();
  await expect(panel.getByTestId("master-availability-preview")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "状態変更を予約" })).toHaveCount(0);
  expect(posts).toBe(0);
});


test("Project schedule and order links navigate to their exact target panels", async ({ page }) => {
  await logInAndMockReadOnlyMasterData(page);
  const viewer = page.locator("#admin-master-data");
  for (const [id, label, prefix] of [
    [scheduleId, "将来Revision予約の下見へ", "admin-master-schedule-demo"],
    [orderId, "将来表示順変更の下見へ", "admin-master-order-demo"],
  ] as const) {
    await viewer.getByLabel("マスタ項目").selectOption(id);
    const link = viewer.getByRole("link", { name: new RegExp(label, "u") });
    const panelId = `${prefix}-${id}`;
    await expect(link).toHaveAttribute("href", `#${panelId}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`#${panelId}$`, "u"));
    await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
  }
});


test("server Preview rejection or outage never enables a Master mutation", async ({ page }) => {
  const panel = await logInAndMockReadOnlyMasterData(page);
  let httpStatus = 403;
  let posts = 0;
  await page.route("**/api/admin/master-operations/schedule/preview?**", async (route) => {
    await route.fulfill({ status: httpStatus, contentType: "application/json",
      body: JSON.stringify({ error: { code: "preview_not_available" } }) });
  });
  await page.route("**/api/admin/master-operations/schedule/execute?**", async (route) => {
    posts += 1;
    await route.abort();
  });
  for (const [status, expected] of [
    [403, "サーバーが操作を許可しませんでした"],
    [404, "サーバーで対象操作を確認できません"],
    [503, "サーバーの操作可否を確認できません"],
  ] as const) {
    httpStatus = status;
    await panel.getByRole("button", { name: "状態変更を下見" }).click();
    await expect(panel.getByTestId("master-availability-readiness")).toContainText(expected);
    await expect(panel.getByRole("button", { name: "状態変更を予約" })).toHaveCount(0);
    await expect(panel.getByTestId("master-availability-preview")).toHaveCount(0);
  }
  expect(posts).toBe(0);
});


test("Project links disappear when the server omits/denies the operation capability", async ({ page }) => {
  await logInAndMockReadOnlyMasterData(page);
  const viewer = page.locator("#admin-master-data");
  // Simulate a trusted Worker response with the same item and no approved
  // operation, even though Project presentation still declares a link.
  await page.route("**/api/admin/master-data?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("itemId") !== enableId) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        item: item(enableId), revisions: [revision(enableId)],
        allowedOperations: [], hasMore: false, asOf: "2026-10-10T00:00:00.000Z",
      }),
    });
  });
  await viewer.getByLabel("マスタ項目").selectOption(disableId);
  await expect(viewer.getByRole("link", { name: /有効・無効切替の下見へ/u })).toBeVisible();
  await viewer.getByLabel("マスタ項目").selectOption(enableId);
  await expect(viewer.getByText("この項目の操作はサーバー側で利用可能と確認できません。")).toBeVisible();
  await expect(viewer.getByRole("link", { name: /有効・無効切替の下見へ/u })).toHaveCount(0);
});

test("actual Master API fails closed when local Worker runtime environment is not declared", async ({ page }) => {
  // Browser harness deliberately runs the root wrangler config, which does
  // not set RUNTIME_ENVIRONMENT. This is not a successful Master read:
  // without a trusted environment the Worker must never disclose capabilities.
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("kai");
  await page.getByLabel("パスワード", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Kai Admin/u })).toBeVisible();
  const response = await page.request.get(
    "/api/admin/master-data?scopeId=workhub-company&masterKey=workhub.office&itemId=" + tokyoId,
  );
  expect(response.status()).toBe(503);
  const body = await response.json() as { error: { code: string } };
  expect(body.error.code).toBe("runtime_environment_required");
});

test("Master revision lifecycle filters separate current, future and history without losing boundaries", async ({ page }) => {
  await logInAndMockReadOnlyMasterData(page);
  const viewer = page.locator("#admin-master-data");
  const asOf = "2026-10-10T00:00:00.000Z";
  const revisions = [
    { ...revision(tokyoId), id: tokyoId + "-r4", revision: 4, label: "Planned",
      lifecycle: "future", effectiveFrom: "2027-04-01T00:00:00.000Z", effectiveTo: null },
    { ...revision(tokyoId), id: tokyoId + "-r3", revision: 3, label: "Current Office",
      lifecycle: "current", effectiveFrom: "2026-04-01T00:00:00.000Z",
      effectiveTo: "2027-04-01T00:00:00.000Z" },
    { ...revision(tokyoId), id: tokyoId + "-r2", revision: 2, label: "Past Office",
      lifecycle: "expired", effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-04-01T00:00:00.000Z" },
  ];
  await page.route("**/api/admin/master-data?**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("itemId");
    if (id !== tokyoId) return route.fallback();
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({
        item: { ...item(tokyoId), retiredAt: "2027-05-01T00:00:00.000Z" },
        revisions, hasMore: true, asOf, allowedOperations: [],
      }),
    });
  });
  await viewer.getByLabel("マスタ項目").selectOption(disableId);
  await viewer.getByLabel("マスタ項目").selectOption(tokyoId);
  await expect(viewer.getByTestId("master-retirement-status")).toHaveText("廃止予定");
  await expect(viewer.getByText("廃止予定のため操作は案内しません。")).toBeVisible();
  await expect(viewer.getByTestId("master-revision-summary")).toContainText("将来予定：1 件");
  await expect(viewer.getByTestId("master-revision-summary")).toContainText("過去・廃止：1 件");
  await expect(viewer.getByText("全履歴の件数ではありません。", { exact: false })).toBeVisible();
  const rows = viewer.locator("table.admin-audit-table tbody tr");
  await expect(rows).toHaveCount(3);
  await viewer.getByLabel("Revisionの表示").selectOption("future");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Planned");
  await expect(rows.first()).toContainText("将来予定");
  await viewer.getByLabel("Revisionの表示").selectOption("active");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Current Office");
  await expect(rows.first()).toContainText("現在有効");
  await viewer.getByLabel("Revisionの表示").selectOption("history");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Past Office");
  await expect(rows.first()).toContainText("期間終了");

  // Changing item resets its previous lifecycle filter rather than hiding
  // the next item's revisions when no future record exists.
  await viewer.getByLabel("マスタ項目").selectOption(enableId);
  await expect(viewer.getByLabel("Revisionの表示")).toHaveValue("all");
  await expect(viewer.getByText("現在無効")).toBeVisible();
});
