import { expect, test, type Page } from "@playwright/test";

/** #419 Stage7: local-only browser acceptance; no provider delivery or remote D1. */
const login = async (page: Page, user = "kai") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: user === "kai" ? /Kai Admin/u : /Aoi Employee/u })).toBeVisible();
};

test("#419 live local Outbox API is authorized, read-only and does not claim provider receipt", async ({ page }) => {
  await login(page);
  const actual = await page.evaluate(async () => {
    const endpoint = "/api/admin/integrations/outbox?scopeId=workhub-company";
    const response = await fetch(endpoint);
    const body: unknown = await response.json();
    const noMutation = await fetch(endpoint, { method: "POST" });
    const otherScope = await fetch("/api/admin/integrations/outbox?scopeId=another-company");
    return { status: response.status, body,
      cacheControl: response.headers.get("cache-control"),
      mutationStatus: noMutation.status, otherScopeStatus: otherScope.status };
  });
  expect(actual.status).toBe(200);
  expect(actual.cacheControl).toBe("no-store");
  const body = actual.body as Record<string, unknown>;
  expect(body.coverage).toBe("environment");
  const evidence = body.deliveryEvidence as Record<string, unknown>;
  expect(evidence.kind).toBe("local_outbox_state");
  expect(evidence.providerReceipt).toBe("unverified");
  const projection = body.connectionStatus as Record<string, unknown>;
  expect(projection.schemaVersion).toBe(1);
  expect(projection.source).toBe("no_provider_monitor_registered");
  expect(projection.coverage).toBe("capability_categories");
  expect(projection.connections).toEqual([
    { capability: "outbound_delivery", connectionState: "unknown",
      monitoringState: "not_monitored", providerCheckAt: null, safeFailureCode: null },
    { capability: "inbound_webhook", connectionState: "unknown",
      monitoringState: "not_monitored", providerCheckAt: null, safeFailureCode: null },
    { capability: "external_document_storage", connectionState: "unknown",
      monitoringState: "not_monitored", providerCheckAt: null, safeFailureCode: null },
  ]);
  expect(JSON.stringify(projection)).not.toMatch(/accessToken|refreshToken|secret|destinationKey|providerResponse/iu);
  for (const key of ["lastDeliveredUpdatedAt", "lastDeadLetterUpdatedAt"]) {
    expect(evidence).toHaveProperty(key);
    expect(evidence[key] === null || typeof evidence[key] === "string").toBe(true);
  }
  expect(JSON.stringify(evidence)).not.toMatch(/payload|credential|secret|destinationKey|rawProvider/iu);
  expect(actual.mutationStatus).toBe(405);
  expect(actual.otherScopeStatus).toBe(403);
});

test("#419 local Outbox evidence is distinct from unverified external receipt and fails closed", async ({ page }) => {
  await login(page);
  let unavailable = false;
  await page.route("**/api/admin/integrations/outbox?**", route => route.fulfill({
    status: unavailable ? 503 : 200,
    contentType: "application/json",
    body: JSON.stringify(unavailable ? { error: { code: "integration_operations_unavailable" } } : {
      coverage: "environment", environment: "local", observedAt: "2026-10-15T00:00:00.000Z",
      deliveryEvidence: {
        kind: "local_outbox_state", lastDeliveredUpdatedAt: "2026-10-14T08:00:00.000Z",
        lastDeadLetterUpdatedAt: "2026-10-14T09:00:00.000Z",
        providerReceipt: "unverified", rawProviderSecret: "must-not-appear",
      },
      credential: "must-not-appear",
      connectionStatus: {
        schemaVersion: 1, coverage: "capability_categories",
        source: "no_provider_monitor_registered",
        connections: [
          { capability: "outbound_delivery", connectionState: "unknown",
            monitoringState: "not_monitored", providerCheckAt: null, safeFailureCode: null },
          { capability: "inbound_webhook", connectionState: "unknown",
            monitoringState: "not_monitored", providerCheckAt: null, safeFailureCode: null },
          { capability: "external_document_storage", connectionState: "unknown",
            monitoringState: "not_monitored", providerCheckAt: null, safeFailureCode: null },
        ],
        rawProviderSecret: "must-not-appear",
      },
    }),
  }));
  await page.goto("/admin");
  const panel = page.getByTestId("integration-status");
  await expect(panel).toContainText("配送完了状態の最終更新");
  await expect(panel).toContainText("Dead Letter状態の最終更新");
  await expect(panel).toContainText("外部Providerの受領照合:");
  await expect(panel).toContainText("未照合");
  const connections = panel.getByTestId("integration-connection-status");
  await expect(connections).toContainText("Provider共通の接続状態");
  await expect(connections).toContainText("外部配送：");
  await expect(connections).toContainText("受信Webhook：");
  await expect(connections).toContainText("外部文書ストレージ：");
  await expect(connections).toContainText("未監視");
  await expect(connections).toContainText("接続状態：不明");
  await expect(connections.locator("li")).toHaveCount(3);
  await expect(panel).not.toContainText("must-not-appear");
  await expect(panel.getByRole("link", { name: /失敗記録と個別の確認方針/u }))
    .toHaveAttribute("href", "#admin-integration-outbox");
  await expect(panel.getByRole("button", { name: /再送|再実行/u })).toHaveCount(0);
  unavailable = true;
  await panel.getByRole("button", { name: "状態を再取得" }).click();
  await expect(panel).toContainText("配送記録は取得できません");
  await expect(panel).not.toContainText("配送完了状態の最終更新");
});

test("#419 malformed provider-neutral status does not become ready or healthy", async ({ page }) => {
  await login(page);
  await page.route("**/api/admin/integrations/outbox?**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      coverage: "environment", environment: "local", observedAt: "2026-10-15T00:00:00.000Z",
      deliveryEvidence: {
        kind: "local_outbox_state", lastDeliveredUpdatedAt: null,
        lastDeadLetterUpdatedAt: null, providerReceipt: "unverified",
      },
      connectionStatus: {
        schemaVersion: 1, coverage: "capability_categories",
        source: "no_provider_monitor_registered",
        connections: [
          { capability: "outbound_delivery", connectionState: "ready",
            monitoringState: "monitored", providerCheckAt: "2026-10-15T00:00:00Z" },
        ],
      },
    }),
  }));
  await page.goto("/admin");
  const panel = page.getByTestId("integration-status");
  await expect(panel).toContainText("配送記録は取得できません");
  await expect(panel).not.toContainText("Provider共通の接続状態");
  await expect(panel).not.toContainText("配送完了状態の最終更新");
});

test("#419 non-admin cannot mount integration evidence or read underlying API", async ({ page }) => {
  await login(page, "aoi");
  const status = await page.evaluate(async () =>
    (await fetch("/api/admin/integrations/outbox?scopeId=workhub-company")).status);
  expect(status).toBe(403);
  await page.goto("/admin");
  await expect(page.getByTestId("integration-status")).toHaveCount(0);
});

test("#419 local failed-Outbox pages are bounded, authorized, read-only and fail closed", async ({ page }) => {
  await login(page);
  const actual = await page.evaluate(async () => {
    const url = "/api/admin/integrations/outbox/_failures?scopeId=workhub-company";
    const result = await fetch(url);
    const body: unknown = await result.json();
    const badCursor = await fetch(url + "&cursor=bad%20cursor");
    const duplicate = await fetch(url + "&cursor=YWJj&cursor=YWJj");
    const badScope = await fetch("/api/admin/integrations/outbox/_failures?scopeId=other-company");
    const noMutation = await fetch(url, { method: "POST" });
    return { status: result.status, body, cache: result.headers.get("cache-control"),
      invalidCursorStatus: badCursor.status, duplicateStatus: duplicate.status,
      badScopeStatus: badScope.status, mutationStatus: noMutation.status };
  });
  expect(actual.status).toBe(200);
  expect(actual.cache).toBe("no-store");
  const body = actual.body as Record<string, unknown>;
  expect(body.coverage).toBe("environment");
  expect(body.providerReceipt).toBe("unverified");
  expect(body.pageLimit).toBe(20);
  expect(Array.isArray(body.items)).toBe(true);
  const items = body.items as Record<string, unknown>[];
  expect(items.length).toBeLessThanOrEqual(20);
  for (const item of items) {
    expect(["dead_letter", "retry_wait"]).toContain(item.status);
    expect(typeof item.outboxId).toBe("string");
    expect(item).not.toHaveProperty("payload");
    expect(item).not.toHaveProperty("destinationKey");
  }
  expect(body.nextCursor === null || typeof body.nextCursor === "string").toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/sensitive-provider-credential|destinationKey|rawProviderResponse/iu);
  expect(actual.invalidCursorStatus).toBe(400);
  expect(actual.duplicateStatus).toBe(400);
  expect(actual.badScopeStatus).toBe(403);
  expect(actual.mutationStatus).toBe(405);
  if (typeof body.nextCursor === "string") {
    const next = await page.evaluate(async cursor =>
      (await fetch("/api/admin/integrations/outbox/_failures?scopeId=workhub-company&cursor="
        + encodeURIComponent(cursor))).status, body.nextCursor);
    expect(next).toBe(200);
  }
  await login(page, "aoi");
  const denied = await page.evaluate(async () =>
    (await fetch("/api/admin/integrations/outbox/_failures?scopeId=workhub-company")).status);
  expect(denied).toBe(403);
});
