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

/** #414: server-owned cross-domain snapshot. Each fixture is bounded, sanitized and versioned. */
const ready = (data: unknown) => ({ kind: "ready", data });
const noSignal = (kind: "denied" | "unknown") => ({ kind });
const overviewFixture = (sources: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: 1, scopeId: "workhub-company", updatedAt: "2026-10-14T00:00:00.000Z",
  jobs: ready({ coverage: "environment", environment: "local",
    observedAt: "2026-10-14T00:00:00.000Z", counts: { failed: 0, deadLetter: 0 } }),
  outbox: ready({ coverage: "environment", environment: "local",
    observedAt: "2026-10-14T00:00:00.000Z", counts: { retryWait: 0, deadLetter: 0 },
    watch: { duePending: 0, dueRetryWait: 0, processing: 0, oldestProcessingUpdatedAt: null },
    sampleLimit: 8, items: [], attentionItems: [] }),
  auditFailures: ready({ items: [], nextCursor: null }),
  privileged: ready({ items: [], nextCursor: null }),
  master: ready({ environment: "local", asOf: "2026-10-14T00:00:00.000Z" }),
  database: ready({ component: "database", status: "ok" }),
  ...sources,
});

test("#414 live local Overview API authenticates admin, bounds source data and rejects mutation", async ({ page }) => {
  await login(page);
  // Use browser fetch, just like the WORKHUB page. The standalone Playwright
  // request client does not carry the browser's login session in this harness.
  const result = await page.evaluate(async () => {
    const endpoint = "/api/admin/operations/overview?scopeId=workhub-company";
    const response = await fetch(endpoint);
    const body: unknown = await response.json();
    const noMutation = await fetch(endpoint, { method: "POST" });
    const wrongScope = await fetch("/api/admin/operations/overview?scopeId=another-tenant");
    return { status: response.status, body, postStatus: noMutation.status,
      wrongScopeStatus: wrongScope.status };
  });
  expect(result.status).toBe(200);
  const body = result.body as Record<string, unknown>;
  expect(body.schemaVersion).toBe(1);
  expect(body.scopeId).toBe("workhub-company");
  expect(body).toHaveProperty("jobs.kind");
  expect(body).toHaveProperty("auditFailures.kind");
  expect(body).toHaveProperty("database.kind");
  expect(body).toHaveProperty("outbox.kind");
  expect(JSON.stringify(body)).not.toMatch(/tokenHash|token_hash|redeemToken|requestId|actorId|rawProviderSecret|payloadFingerprint/iu);
  expect(result.postStatus).toBe(405);
  expect(result.wrongScopeStatus).toBe(403);
});

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
        manualRetryAllowed: false,
        operationGate: { operationId: "DELIVERY_RETRY", risk: "CONTROLLED_CHANGE",
          policyDecision: "DENY", policyVersion: "operations-policy-v1",
          blocker: "provider_receipt_unverified", executionAllowed: false } },
    }),
  }));
  let forgedDecision = false;
  await page.route("**/api/admin/integrations/outbox/safe-1?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      coverage: "environment", environment: "local", observedAt: "2026-10-10T00:00:00.000Z",
      outbox: { outboxId: "safe-1", status: "dead_letter", attemptCount: 2,
        availableAt: "2026-10-09T00:00:00.000Z", lastAttemptAt: "2026-10-09T00:00:00.000Z",
        deliveredAt: null, deadLetteredAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z", version: 3, failureCode: "delivery_outcome_unknown" },
      decision: { nextAction: "reconcile_external_first", providerOutcome: "unverified",
        manualRetryAllowed: false,
        operationGate: { operationId: "DELIVERY_RETRY", risk: "CONTROLLED_CHANGE",
          policyDecision: forgedDecision ? "ALLOW" : "DENY",
          policyVersion: "operations-policy-v1",
          blocker: "provider_receipt_unverified", executionAllowed: false } },
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
  await page.route("**/api/admin/operations/overview?**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: overviewFixture({
      jobs: ready({ coverage: "environment", environment: "local",
        observedAt: "2026-10-10T00:00:00.000Z", counts: { failed: 29, deadLetter: 4 } }),
      outbox: ready({ coverage: "environment", environment: "local",
        observedAt: "2026-10-10T00:00:00.000Z", counts: { retryWait: 10, deadLetter: 3 },
        watch: { duePending: 3, dueRetryWait: 4, processing: 2,
          oldestProcessingUpdatedAt: "2026-10-09T00:00:00.000Z" },
        sampleLimit: 8,
        items: [{ outboxId: "safe-1", status: "dead_letter", attemptCount: 2,
          updatedAt: "2026-10-10T00:00:00.000Z", failureCode: "other" }],
        attentionItems: [{ outboxId: "due-1", status: "pending", attemptCount: 0,
          updatedAt: "2026-10-09T00:00:00.000Z", availableAt: "2026-10-09T00:00:00.000Z",
          failureCode: "other" }],
      }),
      auditFailures: ready({ items: [{ category: "system", action: "operation.JOB_RETRY" }],
        nextCursor: "next-page" }),
      privileged: ready({ items: [
        { category: "system", action: "operation.RETIRE_MASTER_ITEM" },
        { category: "system", action: "readiness_probe" },
      ], nextCursor: null }),
    }),
  }));
  await page.route("**/api/admin/integrations/outbox/_failures?**", route => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({
        coverage: "environment", environment: "local", observedAt: "2026-10-10T00:00:00.000Z",
        pageLimit: 20, providerReceipt: "unverified",
        items: cursor === null
          ? [{ outboxId: "safe-1", status: "dead_letter", attemptCount: 2,
            updatedAt: "2026-10-10T00:00:00.000Z", failureCode: "other" }]
          : [{ outboxId: "old-safe-1", status: "retry_wait", attemptCount: 3,
            updatedAt: "2026-10-09T00:00:00.000Z", failureCode: "provider_unavailable" }],
        nextCursor: cursor === null ? "c2" : null,
        rawProviderSecret: "never-render-paged",
      }),
    });
  });
  // Locally persisted verified-receipt failures, independent of outbound Outbox.
  await page.route("**/api/admin/integrations/inbound/_failures?**", route => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({
        coverage: "environment", source: "local_inbound_receipt",
        environment: "local", observedAt: "2026-10-10T00:00:00.000Z",
        pageLimit: 20, replayAvailable: false,
        items: cursor === null
          ? [{ receiptId: "inbound-1", providerKey: "demo.webhook", status: "dead_letter",
            attemptCount: 3, receivedAt: "2026-10-09T00:00:00.000Z",
            updatedAt: "2026-10-10T00:00:00.000Z", version: 5,
            failureCode: "business_processing_failed" }]
          : [{ receiptId: "older-inbound", providerKey: "demo.webhook", status: "failed",
            attemptCount: 1, receivedAt: "2026-10-08T00:00:00.000Z",
            updatedAt: "2026-10-08T00:00:00.000Z", version: 2,
            failureCode: "other" }],
        nextCursor: cursor === null ? "opaque2" : null,
        replayKey: "never-show-replay-key",
        rawProviderSecret: "never-show-inbound-credential",
      }),
    });
  });
  await page.route("**/api/admin/integrations/inbound/inbound-1?**", route =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({
        coverage: "environment", source: "local_inbound_receipt",
        environment: "local", observedAt: "2026-10-10T00:00:00.000Z",
        receipt: { receiptId: "inbound-1", providerKey: "demo.webhook",
          status: "dead_letter", attemptCount: 3, version: 5,
          receivedAt: "2026-10-09T00:00:00.000Z",
          updatedAt: "2026-10-10T00:00:00.000Z",
          failureCode: "business_processing_failed" },
        decision: { nextAction: "inspect_processing_failure",
          manualRetryAllowed: false, replayAvailable: false },
        rawPayload: "never-show-inbound-payload",
      }),
    }));
  let queueCorrupted = false;
  await page.route("**/api/admin/integrations/failures?**", route => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    const items = cursor === null
      ? [
        { source: "outbound_delivery", id: "safe-1", status: "dead_letter",
          attemptCount: 2, updatedAt: "2026-10-10T00:00:00.000Z",
          version: 3, failureCode: "other", providerKey: null },
        { source: "inbound_webhook", id: "inbound-1", status: "dead_letter",
          attemptCount: 3, updatedAt: "2026-10-10T00:00:00.000Z",
          version: 5, failureCode: "business_processing_failed",
          providerKey: queueCorrupted ? "untrusted<script>" : "demo.webhook" },
      ] : [
        { source: "outbound_delivery", id: "older-queue", status: "retry_wait",
          attemptCount: 1, updatedAt: "2026-10-09T00:00:00.000Z",
          version: 2, failureCode: "provider_unavailable", providerKey: null },
      ];
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({
        coverage: "environment", source: "local_failure_queue",
        environment: "local", observedAt: "2026-10-10T00:00:00.000Z",
        pageLimit: 20, sources: ["outbound_delivery", "inbound_webhook"],
        items, nextCursor: cursor === null ? "queue2" : null,
        providerReceipt: "unverified", manualRetryAllowed: false,
        rawPayload: "never-show-queue-raw-payload",
        suppressedProviderCredential: "never-show-queue-credential",
      }),
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
  await expect(detail.getByTestId("delivery-outcome-unknown")).toContainText("自動再送停止");
  await expect(detail.getByTestId("delivery-outcome-unknown")).toContainText("既存Redriveも拒否されます");
  await expect(detail).toContainText("外部配送結果：未照合");
  await expect(detail.getByTestId("outbox-operation-gate")).toContainText("共通Operations Core判定：再送禁止");
  await expect(detail.getByTestId("outbox-operation-gate")).toContainText("CONTROLLED_CHANGE");
  await expect(detail.getByTestId("outbox-operation-gate")).toContainText("DELIVERY_RETRYは実行できません");
  await page.getByTestId("outbox-watch").getByRole("button", { name: "状態と対応方針を確認" }).click();
  await expect(detail).toContainText("個別Outbox確認：due-1");
  await expect(detail).toContainText("送信待ちです。送信処理の状態を確認してください。");
  await expect(detail).toContainText("外部配送結果：未照合");
  await expect(page.locator("#admin-integration-outbox").getByRole("button", { name: /再送|再実行/u })).toHaveCount(0);

  await page.locator("#admin-integration-outbox")
    .getByRole("button", { name: "直近8件より前の失敗記録を確認" }).click();
  const paged = page.getByTestId("failed-outbox-pages");
  await expect(paged).toContainText("safe-1");
  await expect(paged).not.toContainText("never-render-paged");
  await paged.getByRole("button", { name: "既存の個別詳細を確認" }).click();
  await expect(paged.getByTestId("outbox-detail")).toContainText("Version: 3");
  const reconcile = paged.getByTestId("outbox-reconcile-checklist");
  await expect(reconcile).toContainText("再送前の照合手順");
  await expect(reconcile).toContainText("タイムアウトやUNKNOWNを未配送と決めつけない");
  await expect(reconcile).toContainText("共通Operations Core");
  await expect(reconcile.getByRole("button")).toHaveCount(0);

  await paged.getByRole("button", { name: "次の20件" }).click();
  await expect(paged).toContainText("old-safe-1");
  await expect(paged).not.toContainText("never-render-paged");
  await paged.getByRole("button", { name: "前の20件" }).click();
  await expect(paged).toContainText("safe-1");
  await expect(paged.getByRole("button", { name: /再送|再実行/u })).toHaveCount(0);
  // #419 unified local queue reuses both existing independently-authorized detail routes.
  const unifiedSection = page.locator("#admin-integration-failure-queue");
  await unifiedSection.getByRole("button", { name: "送受信の失敗をまとめて確認" }).click();
  const unified = page.getByTestId("unified-integration-failures");
  await expect(unified).toContainText("safe-1");
  await expect(unified).toContainText("inbound-1");
  await expect(unified.getByTestId("unified-queue-observed-at"))
    .toContainText("2026-10-10T00:00:00.000Z");
  await expect(unified).toContainText("送信Outbox");
  await expect(unified).toContainText("受信Webhook");
  await expect(unified).toContainText("外部ストレージ");
  await expect(unified).not.toContainText("never-show-queue-raw-payload");
  await expect(unified).not.toContainText("never-show-queue-credential");
  await expect(unified.getByRole("button", { name: /再送|再処理|再実行/u })).toHaveCount(0);
  await unified.getByRole("button", { name: "個別詳細を確認" }).first().click();
  const unifiedDetail = page.getByTestId("unified-failure-detail");
  await expect(unifiedDetail.getByTestId("outbox-detail")).toContainText("個別Outbox確認：safe-1");
  await expect(unifiedDetail).toContainText("再送禁止");
  await unified.getByRole("button", { name: "個別詳細を確認" }).nth(1).click();
  await expect(unifiedDetail.getByTestId("inbound-webhook-detail")).toContainText("受信Webhookの個別確認：inbound-1");
  await expect(unifiedDetail).toContainText("再実行不可");
  await unified.getByRole("button", { name: "次の20件" }).click();
  await expect(unifiedDetail).toHaveCount(0); // Prior-page detail must not survive paging.
  await expect(unified).toContainText("older-queue");
  await unified.getByRole("button", { name: "前の20件" }).click();
  await expect(unified).toContainText("safe-1");
  await expect(unifiedDetail).toHaveCount(0);
  await unified.getByRole("button", { name: "個別詳細を確認" }).first().click();
  await expect(unifiedDetail).toContainText("safe-1");
  await unified.getByRole("button", { name: "失敗記録を更新" }).click();
  await expect(unifiedDetail).toHaveCount(0); // Refresh discards stale selection.
  await expect(unified).toContainText("inbound-1");
  await expect(unified.getByTestId("unified-queue-observed-at"))
    .toContainText("キュー取得時点");
  // A corrupt provider key invalidates the WHOLE response, never displays untrusted data.
  queueCorrupted = true;
  await unifiedSection.getByRole("button", { name: "統合失敗キューを閉じる" }).click();
  await unifiedSection.getByRole("button", { name: "送受信の失敗をまとめて確認" }).click();
  await expect(page.getByTestId("unified-integration-failures"))
    .toContainText("両系統の失敗記録を取得できません");
  await expect(unifiedSection).not.toContainText("untrusted<script>");
  await expect(unifiedSection.getByRole("button", { name: /再送|再処理|再実行/u })).toHaveCount(0);
  await unifiedSection.getByRole("button", { name: "統合失敗キューを閉じる" }).click();
  // An untrusted HTTP response must never turn a forged ALLOW into an action.
  forgedDecision = true;
  await paged.getByRole("button", { name: "既存の個別詳細を確認" }).click();
  await expect(paged.getByTestId("outbox-detail")).toContainText("取得できません");
  await expect(paged).not.toContainText("DELIVERY_RETRYは実行できません");
  await expect(page.locator("#admin-integration-outbox")).not.toContainText("sensitive-provider-credential");
  await page.locator("#admin-integration-inbound")
    .getByRole("button", { name: "受信失敗記録を確認" }).click();
  const inbound = page.getByTestId("inbound-webhook-failures");
  await expect(inbound).toContainText("inbound-1");
  await expect(inbound).toContainText("demo.webhook");
  await expect(inbound).toContainText("business_processing_failed");
  await expect(inbound).not.toContainText("never-show-replay-key");
  await expect(inbound).not.toContainText("never-show-inbound-credential");
  await inbound.getByRole("button", { name: "受信処理の詳細を確認" }).click();
  const inboundDetail = inbound.getByTestId("inbound-webhook-detail");
  await expect(inboundDetail).toContainText("Version: 5");
  await expect(inboundDetail).toContainText("再実行不可");
  await expect(inboundDetail).not.toContainText("never-show-inbound-payload");
  await expect(inbound.getByRole("button", { name: /再送|再処理|再実行/u })).toHaveCount(0);
  await inbound.getByRole("button", { name: "次の20件" }).click();
  await expect(inbound).toContainText("older-inbound");
  await inbound.getByRole("button", { name: "前の20件" }).click();
  await expect(inbound).toContainText("inbound-1");
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
  await page.route("**/api/admin/operations/overview?**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: overviewFixture({
      database: ready({ component: "database", status: databaseOk ? "ok" : "unavailable" }),
      jobs: noSignal("unknown"), outbox: noSignal("unknown"),
      master: noSignal("unknown"),
      auditFailures: auditAllowed ? ready({ items: [], nextCursor: null }) : noSignal("denied"),
    }),
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
  const directOverviewStatus = await page.evaluate(async () =>
    (await fetch("/api/admin/operations/overview?scopeId=workhub-company")).status);
  expect(directOverviewStatus).toBe(403);
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
  await page.route("**/api/admin/operations/overview?**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: overviewFixture({
      jobs: ready({ coverage: "environment", environment: "production",
        observedAt: "2026-10-10T00:00:00.000Z", counts: { failed: 9, deadLetter: 1 } }),
      outbox: ready({ coverage: "environment", environment: "production",
        observedAt: "2026-10-10T00:00:00.000Z",
        counts: { retryWait: 7, deadLetter: 4 },
        sampleLimit: 8, items: [], attentionItems: [],
        watch: { duePending: 3, dueRetryWait: 0, processing: 1,
          oldestProcessingUpdatedAt: "2026-10-10T00:00:00.000Z" },
      }),
    }),
  }));
  await page.goto("/admin");
  await expect(card(page, "失敗・Dead Letterジョブ").locator("strong")).toHaveText("環境情報が不一致");
  await expect(card(page, "失敗・Dead Letterジョブ")).toHaveAttribute("data-source-state", "unknown");
  await expect(card(page, "外部連携Outbox").locator("strong")).toHaveText("環境情報が不一致");
  await expect(card(page, "外部連携Outbox")).toHaveAttribute("data-source-state", "unknown");
  await expect(card(page, "Database Readiness").locator("strong")).toHaveText("応答あり");
});
