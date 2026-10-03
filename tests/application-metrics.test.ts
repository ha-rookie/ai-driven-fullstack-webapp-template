import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationMetricsRecorder,
  isSafeMetricDimension,
  toMetricsEnvironment,
  type ApplicationMetricSample,
} from "../src/shared/observability";
import { createFixedClock } from "../src/shared/runtime";

const recorderWith = (
  samples: ApplicationMetricSample[],
  monotonicValues: number[],
  environment: "preview" | "production" | "unknown" = "preview",
) => {
  let index = 0;
  return new ApplicationMetricsRecorder({
    environment,
    component: "worker.http",
    sink: (sample) => samples.push(sample),
    clock: createFixedClock("2026-10-03T00:00:00.000Z"),
    monotonicNow: () => monotonicValues[Math.min(index++, monotonicValues.length - 1)] ?? 0,
  });
};

test("request observation emits count and latency with low-cardinality labels", () => {
  const samples: ApplicationMetricSample[] = [];
  const recorder = recorderWith(samples, [100, 135]);

  recorder.startRequest({
    route: "auth_me",
    method: "GET",
    requestId: "request-123",
  }).complete(200);

  assert.equal(samples.length, 2);
  assert.deepEqual(samples.map((sample) => sample.name), [
    "http_request_count",
    "http_request_duration_ms",
  ]);
  assert.deepEqual(samples[0]?.labels, {
    environment: "preview",
    component: "worker.http",
    route: "auth_me",
    method: "GET",
    statusClass: "2xx",
  });
  assert.equal(samples[1]?.value, 35);
  assert.deepEqual(samples[0]?.correlation, { requestId: "request-123" });
  assert.equal(Object.hasOwn(samples[0]?.labels ?? {}, "requestId"), false);
});

test("HTTP failures emit a bounded error category without response bodies or raw paths", () => {
  const samples: ApplicationMetricSample[] = [];
  const recorder = recorderWith(samples, [0, 5], "production");

  recorder.startRequest({ route: "scoped_resource", method: "PATCH" }).complete(503, {
    errorCategory: "dependency_error",
  });

  assert.equal(samples.length, 3);
  const error = samples.find((sample) => sample.name === "http_error_count");
  assert.equal(error?.labels.environment, "production");
  assert.equal(error?.labels.errorCategory, "dependency_error");
  assert.equal(JSON.stringify(error).includes("/api/scopes/"), false);
});

test("raw URL-like labels are rejected so path parameters cannot become baseline dimensions", () => {
  assert.equal(isSafeMetricDimension("health_ready"), true);
  assert.equal(isSafeMetricDimension("/api/users/user-123"), false);
  assert.throws(
    () => new ApplicationMetricsRecorder({ environment: "preview", component: "worker/http" }),
    /low-cardinality/,
  );

  const recorder = new ApplicationMetricsRecorder({
    environment: "preview",
    component: "worker.http",
    sink: () => undefined,
  });
  assert.throws(
    () => recorder.startRequest({ route: "/api/users/123", method: "GET" }),
    /low-cardinality/,
  );
});

test("unknown runtime environment is explicit rather than guessed as preview or production", () => {
  assert.equal(toMetricsEnvironment(undefined), "unknown");
  assert.equal(toMetricsEnvironment("production"), "production");
  assert.equal(toMetricsEnvironment("preview"), "preview");
  assert.equal(toMetricsEnvironment("prod"), "unknown");
});

test("dependency failure samples use declared dependency/operation dimensions and safe correlation", () => {
  const samples: ApplicationMetricSample[] = [];
  const recorder = recorderWith(samples, [0]);

  recorder.recordDependencyFailure({
    dependency: "d1",
    operation: "health_readiness",
    requestId: "request-db-1",
  });

  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.name, "dependency_failure_count");
  assert.deepEqual(samples[0]?.labels, {
    environment: "preview",
    component: "worker.http",
    dependency: "d1",
    operation: "health_readiness",
  });
  assert.deepEqual(samples[0]?.correlation, { requestId: "request-db-1" });
});

test("request completion is idempotent and broken sinks never alter business flow", () => {
  let sinkCalls = 0;
  const recorder = new ApplicationMetricsRecorder({
    environment: "test",
    component: "worker.http",
    sink: () => {
      sinkCalls += 1;
      throw new Error("sink unavailable");
    },
    monotonicNow: (() => {
      let value = 0;
      return () => value += 1;
    })(),
  });

  const request = recorder.startRequest({ route: "api_other", method: "TRACE" });
  assert.doesNotThrow(() => request.complete(404));
  assert.doesNotThrow(() => request.complete(500));
  assert.equal(sinkCalls, 3);
});
