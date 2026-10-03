import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker";

test("worker API boundary emits runtime request metrics with declared route/environment labels", async () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...values: unknown[]) => {
    lines.push(values.map(String).join(" "));
  };

  try {
    const response = await worker.fetch(
      new Request("https://example.test/api/health/live", {
        headers: { "x-request-id": "runtime-metric-001" },
      }),
      {
        DB: {} as D1Database,
        ASSETS: { fetch: async () => new Response("asset") } as Fetcher,
        RUNTIME_ENVIRONMENT: "test",
      },
    );

    assert.equal(response.status, 200);
    const metricSamples = lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((value): value is Record<string, unknown> => value?.kind === "metric");

    assert.equal(metricSamples.length, 2);
    assert.deepEqual(metricSamples.map((sample) => sample.name), [
      "http_request_count",
      "http_request_duration_ms",
    ]);

    const labels = metricSamples[0]?.labels as Record<string, unknown>;
    assert.equal(labels.environment, "test");
    assert.equal(labels.component, "worker.http");
    assert.equal(labels.route, "health_live");
    assert.equal(labels.method, "GET");
    assert.equal(labels.statusClass, "2xx");
    assert.equal(Object.hasOwn(labels, "requestId"), false);

    const correlation = metricSamples[0]?.correlation as Record<string, unknown>;
    assert.equal(correlation.requestId, "runtime-metric-001");
  } finally {
    console.log = originalLog;
  }
});
