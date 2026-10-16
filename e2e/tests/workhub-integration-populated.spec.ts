import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * #419: real local SQLite/D1 + authenticated Worker, not a mocked D1 store.
 * This fixture intentionally never registers an external Provider or performs delivery.
 */
const PREFIX = "e2e419-";
const TIMESTAMP = "2090-01-01T00:00:00.000Z";
const OUTBOX_IDS = Array.from({ length: 12 }, (_, n) => PREFIX + "out-" + String(n).padStart(2, "0"));
const INBOUND_IDS = Array.from({ length: 13 }, (_, n) => PREFIX + "in-" + String(n).padStart(2, "0"));
const sqlValue = (value: string | number | null) =>
  value === null ? "NULL" : typeof value === "number"
    ? String(value) : "'" + value.replaceAll("'", "''") + "'";

const cleanupSql = [
  "DELETE FROM integration_outbox WHERE environment = 'local' AND id LIKE 'e2e419-%';",
  "DELETE FROM integration_events WHERE environment = 'local' AND id LIKE 'e2e419-%';",
  "DELETE FROM inbound_webhook_receipts WHERE environment = 'local' AND id LIKE 'e2e419-%';",
].join("\n");

const executeLocalSql = (sql: string) => {
  // No --remote and no configuration changes. Same local D1 as the Playwright webServer seed.
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", sql], {
    encoding: "utf8", timeout: 90_000, stdio: "pipe",
  });
};

const seedLocalFailures = () => {
  const statements: string[] = [cleanupSql];
  OUTBOX_IDS.forEach((id, index) => {
    const event = PREFIX + "event-" + String(index).padStart(2, "0");
    const eventFields = [
      event, "local", "workhub.reference.failure", 1, null, null,
      TIMESTAMP, null, null, "{}", TIMESTAMP,
    ];
    statements.push("INSERT INTO integration_events (id, environment, event_type, schema_version, "
      + "aggregate_type, aggregate_id, occurred_at, correlation_id, causation_id, payload_json, created_at) "
      + "VALUES (" + eventFields.map(sqlValue).join(", ") + ");");
    const outboxFields = [
      id, "local", event, "reference.e2e", index % 2 ? "retry_wait" : "dead_letter",
      TIMESTAMP, index + 1, TIMESTAMP, null, null,
      index === 0 ? "raw-provider-private-message" : index % 2 ? "provider_unavailable" : "delivery_outcome_unknown",
      1, TIMESTAMP, TIMESTAMP,
    ];
    statements.push("INSERT INTO integration_outbox (id, environment, integration_event_id, "
      + "destination_key, status, available_at, attempt_count, last_attempt_at, delivered_at, "
      + "dead_lettered_at, failure_code, version, created_at, updated_at) "
      + "VALUES (" + outboxFields.map(sqlValue).join(", ") + ");");
  });
  INBOUND_IDS.forEach((id, index) => {
    const receiptFields = [
      id, "local", "reference.webhook", null, PREFIX + "replay-" + String(index).padStart(2, "0"),
      "reference.event", null, TIMESTAMP, index % 2 ? "failed" : "dead_letter",
      index + 1, index === 0 ? "raw-provider-private-message" : "business_processing_failed",
      1, TIMESTAMP, TIMESTAMP, null,
    ];
    statements.push("INSERT INTO inbound_webhook_receipts (id, environment, provider_key, "
      + "provider_event_id, replay_key, event_type, occurred_at, received_at, status, "
      + "attempt_count, failure_code, version, created_at, updated_at, completed_at) "
      + "VALUES (" + receiptFields.map(sqlValue).join(", ") + ");");
  });
  executeLocalSql(statements.join("\n"));
};

const login = async (page: Page) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("kai");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Kai Admin/u })).toBeVisible();
};

test("#419 populated local D1 failures survive real Worker pagination, masking and detail", async ({ page }) => {
  seedLocalFailures();
  try {
    await login(page);
    const observed = await page.evaluate(async () => {
      const base = "/api/admin/integrations/failures?scopeId=workhub-company";
      const firstResponse = await fetch(base);
      const first = await firstResponse.json() as {
        items: Array<{ source: string; id: string; failureCode: string }>;
        nextCursor: string | null; manualRetryAllowed: boolean; providerReceipt: string;
      };
      const secondResponse = first.nextCursor
        ? await fetch(base + "&cursor=" + encodeURIComponent(first.nextCursor)) : null;
      const second = secondResponse ? await secondResponse.json() as typeof first : null;
      const detailBase = "/api/admin/integrations/";
      const outgoing = await fetch(detailBase + "outbox/e2e419-out-00?scopeId=workhub-company");
      const incoming = await fetch(detailBase + "inbound/e2e419-in-00?scopeId=workhub-company");
      // The new receipt route is a guarded, read-only projection of #719.
      // Reference WORKHUB intentionally registers no actual Provider verifier.
      const receiptUrl = "/api/admin/integrations/outbox/e2e419-out-02/_receipt?scopeId=workhub-company";
      const receiptResponse = await fetch(receiptUrl);
      const receipt = await receiptResponse.json() as {
        assessment: { kind: string; reason?: string; manualRetryAllowed: boolean };
      };
      const nonUnknownReceipt = await fetch(
        "/api/admin/integrations/outbox/e2e419-out-00/_receipt?scopeId=workhub-company");
      const nonUnknownBody = await nonUnknownReceipt.json() as {
        assessment: { kind: string; manualRetryAllowed: boolean };
      };
      const missingReceipt = await fetch(
        "/api/admin/integrations/outbox/e2e419-absent/_receipt?scopeId=workhub-company");
      const deniedReceipt = await fetch(
        "/api/admin/integrations/outbox/e2e419-out-02/_receipt?scopeId=other-company");
      const postReceipt = await fetch(receiptUrl, { method: "POST" });
      const post = await fetch(base, { method: "POST" });
      const otherScope = await fetch("/api/admin/integrations/failures?scopeId=other-company");
      return {
        firstStatus: firstResponse.status, firstCache: firstResponse.headers.get("cache-control"),
        first, secondStatus: secondResponse?.status ?? null, second,
        outgoingStatus: outgoing.status, incomingStatus: incoming.status,
        outgoing: await outgoing.json() as unknown, incoming: await incoming.json() as unknown,
        postStatus: post.status, otherScopeStatus: otherScope.status,
        receiptStatus: receiptResponse.status, receipt,
        nonUnknownStatus: nonUnknownReceipt.status, nonUnknownBody,
        missingReceiptStatus: missingReceipt.status, deniedReceiptStatus: deniedReceipt.status,
        postReceiptStatus: postReceipt.status,
      };
    });

    expect(observed.firstStatus).toBe(200);
    expect(observed.firstCache).toBe("no-store");
    expect(observed.first.manualRetryAllowed).toBe(false);
    expect(observed.first.providerReceipt).toBe("unverified");
    expect(observed.first.items).toHaveLength(20);
    expect(observed.secondStatus).toBe(200);
    expect(observed.second?.items).toHaveLength(5);
    expect(observed.second?.nextCursor).toBeNull();
    const rows = [...observed.first.items, ...(observed.second?.items ?? [])];
    expect(new Set(rows.map(item => item.source + ":" + item.id)).size).toBe(25);
    expect(rows.filter(item => item.source === "outbound_delivery")).toHaveLength(12);
    expect(rows.filter(item => item.source === "inbound_webhook")).toHaveLength(13);
    expect(new Set(rows.map(item => item.id))).toEqual(new Set([...OUTBOX_IDS, ...INBOUND_IDS]));
    expect(rows.find(item => item.id === OUTBOX_IDS[0])?.failureCode).toBe("other");
    expect(rows.find(item => item.id === INBOUND_IDS[0])?.failureCode).toBe("other");
    expect(JSON.stringify(observed)).not.toContain("raw-provider-private-message");
    expect(JSON.stringify(observed)).not.toMatch(/destinationKey|providerSecret|rawProviderResponse/iu);
    expect(observed.outgoingStatus).toBe(200);
    expect(observed.incomingStatus).toBe(200);
    expect(observed.receiptStatus).toBe(200);
    expect(observed.receipt.assessment).toEqual({
      kind: "unverified", reason: "provider_not_registered", manualRetryAllowed: false,
    });
    expect(observed.nonUnknownStatus).toBe(200);
    expect(observed.nonUnknownBody.assessment).toEqual({
      kind: "not_applicable", manualRetryAllowed: false,
    });
    expect(observed.missingReceiptStatus).toBe(404);
    expect(observed.deniedReceiptStatus).toBe(403);
    expect(observed.postReceiptStatus).toBe(405);
    expect(observed.postStatus).toBe(405);
    expect(observed.otherScopeStatus).toBe(403);

    await page.goto("/admin");
    await page.getByRole("button", { name: "送受信の失敗をまとめて確認", exact: true }).click();
    const queue = page.getByTestId("unified-integration-failures");
    await expect(queue.getByRole("listitem")).toHaveCount(20);
    await expect(queue).not.toContainText("raw-provider-private-message");
    await queue.getByRole("button", { name: "次の20件" }).click();
    await expect(queue.getByRole("listitem")).toHaveCount(5);
    await queue.getByRole("button", { name: "個別詳細を確認" }).first().click();
    await expect(page.getByTestId("unified-failure-detail")).toBeVisible();
    await expect(page.getByTestId("unified-failure-detail")).not.toContainText("raw-provider-private-message");
    await expect(queue.getByRole("button", { name: /再送|再実行/u })).toHaveCount(0);
    await expect(page.getByTestId("unified-failure-detail").getByRole("button", { name: /再送|再実行/u })).toHaveCount(0);

    // Known exact ID from page one remains inspectable from the UI after paging.
    const lookup = queue.getByRole("form", { name: "記録IDから詳細確認" });
    await lookup.getByRole("textbox", { name: "記録ID" }).fill("e2e419-out-02");
    await lookup.getByRole("button", { name: "指定IDの詳細を確認" }).click();
    const detail = page.getByTestId("unified-failure-detail");
    await expect(detail.getByTestId("delivery-outcome-unknown")).toBeVisible();
    await detail.getByRole("button", { name: "受領証跡の状態を確認（参照のみ）" }).click();
    await expect(detail.getByTestId("outbox-receipt-assessment")).toContainText(
      "Provider照合Adapter未登録。外部受領は未確認、再送不可");
    await expect(detail.getByTestId("outbox-operation-gate")).toContainText("再送禁止");
    await expect(detail.getByTestId("outbox-reconcile-gate")).toContainText("DENY");
    await expect(detail.getByRole("button", { name: /再送|再実行/u })).toHaveCount(0);
  } finally {
    executeLocalSql(cleanupSql);
  }
});
