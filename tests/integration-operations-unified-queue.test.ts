import assert from "node:assert/strict";
import test from "node:test";
import { handleIntegrationOperationsApi } from "../src/worker/administration/integration-operations-api";

/** Synthetic populated D1 test double: no external Provider, DB write or remote operation. */
type Source = "outbound" | "inbound";
interface FailureRow {
  id: string; environment: string; status: string; attempt_count: number;
  updated_at: string; failure_code: string | null; version: number;
  provider_key?: string; received_at?: string;
}
const time = "2026-10-16T00:00:00.000Z";
const older = "2026-10-15T23:59:00.000Z";
const outRows: FailureRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: "out-" + String(i).padStart(2, "0"), environment: "test",
  status: i % 2 ? "retry_wait" : "dead_letter", attempt_count: i,
  updated_at: time, failure_code: i === 0 ? "raw-provider-credential" : "provider_unavailable",
  version: 1,
}));
const inRows: FailureRow[] = [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: "in-" + String(i).padStart(2, "0"), environment: "test",
    status: i % 2 ? "failed" : "dead_letter", attempt_count: i,
    updated_at: time, failure_code: i === 0 ? "raw-provider-signature" : "business_processing_failed",
    version: 1, provider_key: "reference.webhook", received_at: time,
  })),
  { id: "in-older", environment: "test", status: "failed", attempt_count: 1,
    updated_at: older, failure_code: "business_processing_failed", version: 1,
    provider_key: "reference.webhook", received_at: older },
  { id: "foreign-production", environment: "production", status: "failed", attempt_count: 1,
    updated_at: time, failure_code: "business_processing_failed", version: 1,
    provider_key: "reference.webhook", received_at: time },
];

const fixture = (options: { failedSource?: Source; role?: string } = {}) => {
  const sqlReads: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first(): Promise<Record<string, unknown> | null> {
              if (sql.includes("FROM application_sessions")) {
                return { id: "operator", displayName: null,
                  expiresAt: "2099-01-01T00:00:00.000Z",
                  lastSeenAt: new Date().toISOString() };
              }
              if (sql.includes("FROM scope_memberships")) {
                assert.deepEqual(args, ["operator", "workhub-company"]);
                return { scopeId: "workhub-company", userId: "operator",
                  role: options.role ?? "system_admin" };
              }
              if (sql.includes("FROM integration_outbox")) {
                const row = outRows.find(r => r.environment === args[0] && r.id === args[1]);
                return row ? { ...row, available_at: time, last_attempt_at: null,
                  delivered_at: null, dead_lettered_at: null } : null;
              }
              if (sql.includes("FROM inbound_webhook_receipts")) {
                const row = inRows.find(r => r.environment === args[0] && r.id === args[1]);
                return row ? { ...row } : null;
              }
              throw new Error("Unrecognized query");
            },
            async all(): Promise<{ results: FailureRow[] }> {
              const source: Source = sql.includes("FROM integration_outbox") ? "outbound" : "inbound";
              assert.ok(sql.includes(source === "outbound"
                ? "FROM integration_outbox" : "FROM inbound_webhook_receipts"));
              sqlReads.push(sql);
              if (options.failedSource === source) throw new Error("hidden-provider-secret");
              let rows = (source === "outbound" ? outRows : inRows)
                .filter(r => r.environment === args[0]);
              if (sql.includes("updated_at = ? AND id < ?")) {
                rows = rows.filter(r => r.updated_at < String(args[1])
                  || (r.updated_at === String(args[2]) && r.id < String(args[3])));
              } else if (sql.includes("updated_at <= ?")) {
                rows = rows.filter(r => r.updated_at <= String(args[1]));
              } else if (sql.includes("updated_at < ?")) {
                rows = rows.filter(r => r.updated_at < String(args[1]));
              }
              rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)
                || b.id.localeCompare(a.id));
              assert.match(sql, /ORDER BY updated_at DESC, id DESC LIMIT \?/u);
              assert.equal(args.at(-1), 21, "each source must be bounded to page size + 1");
              return { results: rows.slice(0, 21) };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const call = (path: string, method = "GET") => handleIntegrationOperationsApi(
    new Request("https://example.test" + path, {
      method, headers: { cookie: "app_session=test-fixture-token" },
    }),
    { DB: db, RUNTIME_ENVIRONMENT: "test" }, "correlation-419",
    { singleScopeSummaryId: "workhub-company" },
  );
  return { call, sqlReads };
};
const route = "/api/admin/integrations/failures?scopeId=workhub-company";
interface FailurePage {
  coverage: string; source: string; providerReceipt: string; manualRetryAllowed: boolean;
  nextCursor: string | null;
  items: { id: string; source: string; failureCode: string; providerKey: string | null }[];
}

test("#419 populated mixed failures page without skipping equal-time inbound records", async () => {
  const f = fixture();
  const first = await f.call(route);
  assert.equal(first?.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  const a = await first.json() as FailurePage;
  assert.equal(a.coverage, "environment");
  assert.equal(a.source, "local_failure_queue");
  assert.equal(a.providerReceipt, "unverified");
  assert.equal(a.manualRetryAllowed, false);
  assert.equal(a.items.length, 20);
  assert.ok(a.nextCursor);

  const second = await f.call(route + "&cursor=" + encodeURIComponent(a.nextCursor));
  assert.equal(second?.status, 200);
  const b = await second.json() as FailurePage;
  assert.equal(b.items.length, 5);
  assert.equal(b.nextCursor, null);
  const items = [...a.items, ...b.items];
  const observed = items.map(r => r.source + ":" + r.id);
  const expected = [
    ...Array.from({ length: 12 }, (_, i) =>
      "outbound_delivery:out-" + String(11 - i).padStart(2, "0")),
    ...Array.from({ length: 12 }, (_, i) =>
      "inbound_webhook:in-" + String(11 - i).padStart(2, "0")),
    "inbound_webhook:in-older",
  ];
  assert.deepEqual(observed, expected);
  assert.equal(new Set(observed).size, 25);
  assert.equal(observed.includes("inbound_webhook:foreign-production"), false);
  assert.equal(items.find(r => r.id === "out-00")?.failureCode, "other");
  assert.equal(items.find(r => r.id === "in-00")?.failureCode, "other");
  assert.equal(items.find(r => r.id === "in-01")?.providerKey, "reference.webhook");
  assert.equal(items.find(r => r.id === "out-01")?.providerKey, null);
  assert.doesNotMatch(JSON.stringify(items), /raw-provider-credential|raw-provider-signature/u);
  assert.equal(f.sqlReads.length, 4, "one bounded read per source per page");
  assert.ok(f.sqlReads.some(q => q.includes("updated_at = ? AND id < ?")));
});

test("#419 exact local details are read only and source-specific after a populated listing", async () => {
  const f = fixture();
  for (const [source, id, field] of [
    ["outbox", "out-00", "outbox"], ["inbound", "in-00", "receipt"],
  ]) {
    const response = await f.call("/api/admin/integrations/" + source + "/" + id
      + "?scopeId=workhub-company");
    assert.equal(response?.status, 200);
    const body = await response.json() as Record<string, unknown>;
    const record = body[field] as Record<string, unknown>;
    assert.ok(record);
    assert.equal(record.failureCode, "other");
    assert.doesNotMatch(JSON.stringify(body), /raw-provider-credential|raw-provider-signature/u);
  }
  assert.equal((await f.call(route, "POST"))?.status, 405);
  assert.equal((await fixture({ role: "viewer" }).call(route))?.status, 403);
});

test("#419 source outage fails entire unified queue closed, not partial healthy results", async () => {
  for (const source of ["outbound", "inbound"] as const) {
    const response = await fixture({ failedSource: source }).call(route);
    assert.equal(response?.status, 503);
    assert.doesNotMatch(await response.text(), /hidden-provider-secret/u);
  }
  assert.equal((await fixture().call(route + "&cursor=bad%20cursor"))?.status, 400);
});
