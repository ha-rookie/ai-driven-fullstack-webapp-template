import { expect, test, type Page } from "@playwright/test";

/** #414: browser-only API fixtures; never mutate Preview/Production data. */
const login = async (page: Page, user = "kai") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: user === "kai" ? /Kai Admin/u : /Aoi Employee/u })).toBeVisible();
};

const card = (page: Page, title: string) =>
  page.locator("#admin-operations-overview .admin-overview-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("overview summarizes bounded authorized signals without claiming complete health", async ({ page }) => {
  await login(page);
  await page.route("**/api/health/ready", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ component: "database", status: "ok" }),
  }));
  await page.route("**/api/admin/jobs?**", (route) => {
    const state = new URL(route.request().url()).searchParams.get("state");
    const count = state === "failed" ? 2 : state === "dead_letter" ? 1 : 0;
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items: Array.from({ length: count }, () => ({ state })), limit: 20 }),
    });
  });
  await page.route("**/api/admin/jobs/summary?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      coverage: "environment", environment: "local",
      observedAt: "2026-10-10T00:00:00.000Z",
      counts: { failed: 29, deadLetter: 4 },
    }),
  }));
  await page.route("**/api/admin/integrations/outbox?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      coverage: "environment", environment: "local", observedAt: "2026-10-10T00:00:00.000Z",
      counts: { retryWait: 10, deadLetter: 3 }, sampleLimit: 8,
      watch: { duePending: 3, dueRetryWait: 4, processing: 2,
        oldestProcessingUpdatedAt: "2026-10-09T00:00:00.000Z" },
      items: [{ outboxId: "safe-1", status: "dead_letter", attemptCount: 2,
        updatedAt: "2026-10-10T00:00:00.000Z", failureCode: "other" }],
      attentionItems: [{ outboxId: "due-1", status: "pending", attemptCount: 0,
        updatedAt: "2026-10-09T00:00:00.000Z", availableAt: "2026-10-09T00:00:00.000Z",
        failureCode: "other" }],
    }),
  }));
  await page.route("**/api/admin/integrations/outbox/due-1?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      coverage: "environment", environment: "local", observedAt: "2026-10-10T00:00:00.000Z",
      outbox: { outboxId: "due-1", status: "pending", attemptCount: 0,
        availableAt: "2026-10-09T00:00:00.000Z", lastAttemptAt: null,
        deliveredAt: null, deadLetteredAt: null,
        updatedAt: "2026-10-09T00:00:00.000Z", version: 1, failureCode: "other" },
      decision: { nextAction: "queued", providerOutcome: "unverified",
        manualRetryAllowed: false },
    }),
  }));
  await page.route("**/api/admin/integrations/outbox/safe-1?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      coverage: "environment", environment: "local", observedAt: "2026-10-10T00:00:00.000Z",
      outbox: { outboxId: "safe-1", status: "dead_letter", attemptCount: 2,
        availableAt: "2026-10-09T00:00:00.000Z", lastAttemptAt: "2026-10-09T00:00:00.000Z",
        deliveredAt: null, deadLetteredAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z", version: 3, failureCode: "other" },
      decision: { nextAction: "reconcile_external_first", providerOutcome: "unverified",
        manualRetryAllowed: false },
    }),
  }));
  await page.route("**/api/admin/audit?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const items = query.get("outcome") === "failure"
      ? [{ id: "audit-failed", category: "system", action: "operation.JOB_RETRY" }]
      : query.get("category") === "system"
        ? [{ id: "privileged", category: "system", action: "operation.RETIRE_MASTER_ITEM" },
          { id: "unrelated", category: "system", action: "readiness_probe" }] : [];
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ items, nextCursor: query.get("outcome") === "failure" ? "next-page" : null }) });
  });
  await page.route("**/api/admin/master-data?**", (route) => {
    const itemId = new URL(route.request().url()).searchParams.get("itemId");
    const body = itemId
      ? {
        item: { id: itemId, code: "DEMO", version: 2, retiredAt: null },
        revisions: [{
          id: itemId + "-r1", revision: 1, label: "Demo",
          enabled: true, effectiveFrom: "2026-01-01T00:00:00.000Z",
          effectiveTo: null, displayOrder: 10, parentItemId: null, lifecycle: "current",
        }],
        allowedOperations: [], hasMore: false,
        asOf: "2026-10-10T00:00:00.000Z",
      }
      : { items: [], environment: "local", asOf: "2026-10-10T00:00:00.000Z", hasMore: false };
    return route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(body),
    });
  });
  await page.goto("/admin");
  const summary = page.locator("#admin-operations-overview");
  await expect(card(page, "Database Readiness").locator("strong")).toHaveText("応答あり");
  await expect(card(page, "失敗・Dead Letterジョブ").locator("strong")).toHaveText("33 件（環境内の現在状態）");
  await expect(card(page, "監査失敗").locator("strong")).toHaveText("1 件以上（続きあり）");
  await expect(card(page, "監査失敗")).toHaveAttribute("data-coverage", "bounded_sample");
  await expect(card(page, "監査失敗")).toHaveAttribute("data-source-state", "available");
  await expect(card(page, "Security Finding")).toHaveAttribute("data-source-state", "not_monitored");
  await expect(card(page, "失敗・Dead Letterジョブ")).toHaveAttribute("data-coverage", "environment_current");
  await expect(card(page, "直近の特権操作").locator("strong")).toContainText("1 件");
  await expect(card(page, "Security Finding").locator("strong")).toHaveText("未接続");
  await expect(card(page, "外部連携Outbox").locator("strong")).toHaveText("要確認 3 / 再試行待ち 10 件（環境内の現在状態）");
  await expect(card(page, "外部連携Outbox")).toHaveAttribute("data-coverage", "environment_current");
  await expect(page.locator("#admin-integration-outbox")).toContainText("safe-1");
  await expect(page.getByTestId("outbox-watch")).toContainText("送信待ちで予定時刻到達：3 件");
  await expect(page.getByTestId("outbox-watch")).toContainText("再試行待ちで予定時刻到達：4 件");
  await expect(page.getByTestId("outbox-watch")).toContainText("処理中：2 件");
  await expect(page.getByTestId("outbox-watch")).toContainText("障害確定ではありません");
  await page.locator("#admin-integration-outbox").getByRole("button", { name: "状態と対応方針を確認" }).first().click();
  const detail = page.getByTestId("outbox-detail");
  await expect(detail).toContainText("外部サービス側の配送結果を照合してください");
  await expect(detail).toContainText("Version: 3");
  await expect(detail).toContainText("外部配送結果：未照合");
  await page.getByTestId("outbox-watch").getByRole("button", { name: "状態と対応方針を確認" }).click();
  await expect(detail).toContainText("個別Outbox確認：due-1");
  await expect(detail).toContainText("送信待ちです。送信処理の状態を確認してください。");
  await expect(detail).toContainText("外部配送結果：未照合");
  await expect(page.locator("#admin-integration-outbox").getByRole("button", { name: /再送|再実行/u })).toHaveCount(0);

  await expect(page.locator("#admin-integration-outbox")).not.toContainText("sensitive-provider-credential");
  await expect(card(page, "Metrics / Alert").locator("strong")).toHaveText("未接続");
  await expect(summary.getByTestId("operations-overview-environment")).toContainText("Server Environment: local");
  await expect(summary.getByText(/複数Scopeへ転用不可/u)).toBeVisible();
  await card(page, "失敗・Dead Letterジョブ").getByRole("link", { name: "詳細を確認 →" }).click();
  await expect(page).toHaveURL(/#admin-jobs-and-integrations$/u);
});

test("overview shows degraded and denied sources as non-healthy, then refreshes independently", async ({ page }) => {
  await login(page);
  let databaseOk = false;
  let auditAllowed = false;
  await page.route("**/api/health/ready", (route) => route.fulfill({
    status: databaseOk ? 200 : 503, contentType: "application/json",
    body: JSON.stringify({ component: "database", status: databaseOk ? "ok" : "unavailable" }),
  }));
  await page.route("**/api/admin/jobs?**", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "job_operations_unavailable" } }),
  }));
  await page.route("**/api/admin/integrations/outbox?**", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "integration_operations_unavailable" } }),
  }));
  await page.route("**/api/admin/jobs/summary?**", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "job_operations_unavailable" } }),
  }));
  await page.route("**/api/admin/audit?**", (route) => {
    const failed = new URL(route.request().url()).searchParams.get("outcome") === "failure";
    return route.fulfill({
      status: auditAllowed || !failed ? 200 : 403, contentType: "application/json",
      body: JSON.stringify(auditAllowed || !failed ? { items: [], nextCursor: null } : { error: { code: "forbidden" } }),
    });
  });
  await page.route("**/api/admin/master-data?**", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "master_data_unavailable" } }),
  }));
  await page.goto("/admin");
  await expect(card(page, "Database Readiness").locator("strong")).toHaveText("接続異常");
  await expect(card(page, "失敗・Dead Letterジョブ").locator("strong")).toHaveText("取得できません");
  await expect(card(page, "外部連携Outbox").locator("strong")).toHaveText("取得できません");
  await expect(card(page, "監査失敗").locator("strong")).toHaveText("閲覧不可");
  await expect(page.getByTestId("operations-overview-environment")).toContainText("Server Environment: 取得できません");

  databaseOk = true;
  auditAllowed = true;
  await page.locator("#admin-operations-overview").getByRole("button", { name: "最新状態を確認" }).click();
  await expect(card(page, "Database Readiness").locator("strong")).toHaveText("応答あり");
  await expect(card(page, "監査失敗").locator("strong")).toHaveText("0 件（取得範囲）");
  await expect(card(page, "Security Finding").locator("strong")).toHaveText("未接続");
});

test("non-admin user never mounts operational overview or loads privileged overview data", async ({ page }) => {
  await login(page, "aoi");
  let privilegedReads = 0;
  let outboxReads = 0;
  await page.route("**/api/admin/integrations/outbox?**", (route) => {
    outboxReads += 1;
    return route.fulfill({ status: 403 });
  });
  await page.route("**/api/admin/audit?**", (route) => {
    privilegedReads += 1;
    return route.fulfill({ status: 403 });
  });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "この領域を表示する権限がありません" })).toBeVisible();
  await expect(page.locator("#admin-operations-overview")).toHaveCount(0);
  expect(privilegedReads).toBe(0);
  expect(outboxReads).toBe(0);
});


test("overview refuses to combine a job count from a different environment", async ({ page }) => {
  await login(page);
  await page.route("**/api/health/ready", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ component: "database", status: "ok" }),
  }));
  await page.route("**/api/admin/jobs/summary?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      coverage: "environment", environment: "production",
      observedAt: "2026-10-10T00:00:00.000Z",
      counts: { failed: 9, deadLetter: 1 },
    }),
  }));
  await page.route("**/api/admin/integrations/outbox?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      coverage: "environment", environment: "production",
      observedAt: "2026-10-10T00:00:00.000Z",
      counts: { retryWait: 7, deadLetter: 4 }, sampleLimit: 8, items: [],
      watch: { duePending: 3, dueRetryWait: 0, processing: 1,
        oldestProcessingUpdatedAt: "2026-10-10T00:00:00.000Z" },
      attentionItems: [],
    }),
  }));
  await page.route("**/api/admin/audit?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ items: [], nextCursor: null }),
  }));
  await page.route("**/api/admin/master-data?**", (route) => {
    const itemId = new URL(route.request().url()).searchParams.get("itemId");
    const body = itemId ? {
      item: { id: itemId, code: "DEMO", version: 2, retiredAt: null },
      revisions: [{ id: itemId + "-r1", revision: 1, label: "Demo",
        enabled: true, effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null,
        displayOrder: 10, parentItemId: null, lifecycle: "current" }],
      allowedOperations: [], hasMore: false, asOf: "2026-10-10T00:00:00.000Z",
    } : { environment: "local", asOf: "2026-10-10T00:00:00.000Z", items: [], hasMore: false };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/admin");
  await expect(card(page, "失敗・Dead Letterジョブ").locator("strong")).toHaveText("環境情報が不一致");
  await expect(card(page, "失敗・Dead Letterジョブ")).toHaveAttribute("data-source-state", "unknown");
  await expect(card(page, "外部連携Outbox").locator("strong")).toHaveText("環境情報が不一致");
  await expect(card(page, "外部連携Outbox")).toHaveAttribute("data-source-state", "unknown");
  await expect(card(page, "Database Readiness").locator("strong")).toHaveText("応答あり");
});
