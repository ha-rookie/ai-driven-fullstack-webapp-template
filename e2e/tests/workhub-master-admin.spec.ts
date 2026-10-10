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
    const id = query.get("itemId");
    const body = id
      ? { item: item(id), revisions: [revision(id)], hasMore: false, asOf: "2026-10-10T00:00:00.000Z" }
      : { items: [item(tokyoId), item(disableId), item(enableId), item(scheduleId), item(orderId)],
        hasMore: false, environment: "local", asOf: "2026-10-10T00:00:00.000Z" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/admin");
  const viewer = page.locator("#admin-master-data");
  await expect(viewer.getByRole("heading", { name: "マスタ管理（参照）" })).toBeVisible();
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
