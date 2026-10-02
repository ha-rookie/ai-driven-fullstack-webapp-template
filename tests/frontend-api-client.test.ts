import assert from "node:assert/strict";
import test from "node:test";

import { ApiClient, ApiClientError, type FetchLike } from "../src/frontend/api";

const jsonResponse = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
});

const dtoDecoder = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" ? { id: record.id } : null;
};

test("client sends same-origin JSON request and decodes shared success envelope", async () => {
  let observedInput: RequestInfo | URL | undefined;
  let observedInit: RequestInit | undefined;
  const fetchImpl: FetchLike = async (input, init) => {
    observedInput = input;
    observedInit = init;
    return jsonResponse({ data: { id: "r1", internal: "ignored" }, requestId: "req-1" });
  };
  const client = new ApiClient({ fetch: fetchImpl });

  const result = await client.request("/api/resources", dtoDecoder, {
    method: "POST",
    body: { name: "Example" },
  });

  assert.deepEqual(result, { data: { id: "r1" }, requestId: "req-1" });
  assert.equal(observedInput, "/api/resources");
  assert.equal(observedInit?.credentials, "same-origin");
  assert.equal(observedInit?.method, "POST");
  assert.equal((observedInit?.headers as Headers).get("content-type"), "application/json; charset=utf-8");
  assert.equal(observedInit?.body, JSON.stringify({ name: "Example" }));
});

test("unsafe methods receive injected CSRF proof while safe methods do not", async () => {
  const observed: Headers[] = [];
  const fetchImpl: FetchLike = async (_input, init) => {
    observed.push(init?.headers as Headers);
    return jsonResponse({ data: { id: "r1" }, requestId: "req-2" });
  };
  const client = new ApiClient({ fetch: fetchImpl, getCsrfToken: () => "csrf-proof" });

  await client.request("/api/resources", dtoDecoder);
  await client.request("/api/resources", dtoDecoder, { method: "PATCH", body: { name: "Changed" } });

  assert.equal(observed[0]?.get("x-csrf-token"), null);
  assert.equal(observed[1]?.get("x-csrf-token"), "csrf-proof");
});

test("HTTP error is never returned as success data and exposes only shared public error fields", async () => {
  const client = new ApiClient({
    fetch: async () => jsonResponse({
      error: { code: "conflict", message: "Conflict" },
      requestId: "req-conflict",
      internalTrace: "must not be promoted",
    }, { status: 409 }),
  });

  await assert.rejects(
    client.request("/api/resources/r1", dtoDecoder),
    (error) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.kind, "http");
      assert.equal(error.status, 409);
      assert.equal(error.requestId, "req-conflict");
      assert.deepEqual(error.apiError, {
        error: { code: "conflict", message: "Conflict" },
        requestId: "req-conflict",
      });
      assert.equal(JSON.stringify(error).includes("internalTrace"), false);
      return true;
    },
  );
});

test("malformed HTTP error falls back to bounded generic error with header request id", async () => {
  const client = new ApiClient({
    fetch: async () => new Response("private stack", {
      status: 500,
      headers: { "content-type": "text/plain", "x-request-id": "req-header" },
    }),
  });

  await assert.rejects(client.request("/api/failure", dtoDecoder), (error) => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.kind, "http");
    assert.equal(error.message, "Request failed");
    assert.equal(error.requestId, "req-header");
    assert.equal(error.message.includes("private stack"), false);
    return true;
  });
});

test("schema mismatch and non-JSON success are protocol failures", async () => {
  const malformed = new ApiClient({ fetch: async () => jsonResponse({ data: { id: 42 }, requestId: "req-3" }) });
  await assert.rejects(malformed.request("/api/resources", dtoDecoder), (error) => error instanceof ApiClientError && error.kind === "protocol");

  const nonJson = new ApiClient({ fetch: async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }) });
  await assert.rejects(nonJson.request("/api/resources", dtoDecoder), (error) => error instanceof ApiClientError && error.kind === "protocol");
});

test("204 has an explicit no-content path", async () => {
  const client = new ApiClient({
    fetch: async () => new Response(null, { status: 204, headers: { "x-request-id": "req-204" } }),
  });
  assert.deepEqual(await client.requestNoContent("/api/resources/r1", { method: "DELETE" }), { requestId: "req-204" });
  await assert.rejects(client.request("/api/resources/r1", dtoDecoder), (error) => error instanceof ApiClientError && error.kind === "protocol");
});

test("network, timeout and caller abort are distinct failures", async () => {
  const network = new ApiClient({ fetch: async () => { throw new Error("socket detail"); } });
  await assert.rejects(network.request("/api/x", dtoDecoder), (error) => error instanceof ApiClientError && error.kind === "network" && !error.message.includes("socket detail"));

  const abortingFetch: FetchLike = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const timeout = new ApiClient({ fetch: abortingFetch, defaultTimeoutMs: 5 });
  await assert.rejects(timeout.request("/api/x", dtoDecoder), (error) => error instanceof ApiClientError && error.kind === "timeout");

  const controller = new AbortController();
  const aborted = new ApiClient({ fetch: abortingFetch });
  const pending = aborted.request("/api/x", dtoDecoder, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof ApiClientError && error.kind === "aborted");
});

test("client refuses arbitrary external URLs and invalid GET bodies", async () => {
  const client = new ApiClient({ fetch: async () => jsonResponse({ data: { id: "r1" }, requestId: "req" }) });
  await assert.rejects(client.request("https://evil.example/api", dtoDecoder), /same-origin/);
  await assert.rejects(client.request("//evil.example/api", dtoDecoder), /same-origin/);
  await assert.rejects(client.request("/api/resources", dtoDecoder, { method: "GET", body: { invalid: true } }), /cannot include/);
});
