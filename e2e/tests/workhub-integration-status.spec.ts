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
    }),
  }));
  await page.goto("/admin");
  const panel = page.getByTestId("integration-status");
  await expect(panel).toContainText("配送完了状態の最終更新");
  await expect(panel).toContainText("Dead Letter状態の最終更新");
  await expect(panel).toContainText("外部Providerの受領照合:");
  await expect(panel).toContainText("未照合");
  await expect(panel).toContainText("外部ストレージ接続状態:");
  await expect(panel).toContainText("未監視");
  await expect(panel).not.toContainText("must-not-appear");
  await expect(panel.getByRole("link", { name: /失敗記録と個別の確認方針/u }))
    .toHaveAttribute("href", "#admin-integration-outbox");
  await expect(panel.getByRole("button", { name: /再送|再実行/u })).toHaveCount(0);
  unavailable = true;
  await panel.getByRole("button", { name: "状態を再取得" }).click();
  await expect(panel).toContainText("配送記録は取得できません");
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
