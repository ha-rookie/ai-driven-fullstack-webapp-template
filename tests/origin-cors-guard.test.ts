import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCorsResponseHeaders,
  buildCorsPreflightResponse,
  CorsConfigurationError,
  createCorsPolicy,
  evaluateCorsRequest,
} from "../src/worker/http";

const policy = createCorsPolicy({
  allowedOrigins: "https://app.example.com,https://admin.example.com",
});

test("empty config keeps the baseline same-origin only", () => {
  const empty = createCorsPolicy();
  assert.equal(empty.allowedOrigins.size, 0);
});

test("configured origins must be exact canonical http(s) origins", () => {
  assert.throws(
    () => createCorsPolicy({ allowedOrigins: "*" }),
    CorsConfigurationError,
  );
  assert.throws(
    () => createCorsPolicy({ allowedOrigins: "null" }),
    CorsConfigurationError,
  );
  assert.throws(
    () => createCorsPolicy({ allowedOrigins: "https://app.example.com/" }),
    CorsConfigurationError,
  );
  assert.throws(
    () => createCorsPolicy({ allowedOrigins: "https://app.example.com/path" }),
    CorsConfigurationError,
  );
});

test("requests without Origin remain non-CORS", () => {
  const decision = evaluateCorsRequest(
    new Request("https://api.example.com/api/health"),
    policy,
  );

  assert.deepEqual(decision, { kind: "allow", mode: "non-cors" });
});

test("same-origin requests are allowed without requiring the cross-origin allowlist", () => {
  const decision = evaluateCorsRequest(
    new Request("https://api.example.com/api/health", {
      headers: { Origin: "https://api.example.com" },
    }),
    createCorsPolicy(),
  );

  assert.deepEqual(decision, {
    kind: "allow",
    mode: "same-origin",
    origin: "https://api.example.com",
  });
});

test("only exact configured cross-origin values are allowed", () => {
  const allowed = evaluateCorsRequest(
    new Request("https://api.example.com/api/health", {
      headers: { Origin: "https://app.example.com" },
    }),
    policy,
  );
  const suffixBypass = evaluateCorsRequest(
    new Request("https://api.example.com/api/health", {
      headers: { Origin: "https://app.example.com.evil.test" },
    }),
    policy,
  );
  const nullOrigin = evaluateCorsRequest(
    new Request("https://api.example.com/api/health", {
      headers: { Origin: "null" },
    }),
    policy,
  );

  assert.deepEqual(allowed, {
    kind: "allow",
    mode: "cross-origin",
    origin: "https://app.example.com",
  });
  assert.deepEqual(suffixBypass, {
    kind: "reject",
    reason: "origin_not_allowed",
  });
  assert.deepEqual(nullOrigin, { kind: "reject", reason: "invalid_origin" });
});

test("allowed preflight is handled without authentication", async () => {
  const decision = evaluateCorsRequest(
    new Request("https://api.example.com/api/resource", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "Content-Type, If-Match, X-Request-Id",
      },
    }),
    policy,
  );

  assert.equal(decision.kind, "preflight");
  if (decision.kind !== "preflight") return;

  const response = buildCorsPreflightResponse(decision, policy);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://app.example.com",
  );
  assert.equal(
    response.headers.get("access-control-allow-credentials"),
    "true",
  );
  assert.match(
    response.headers.get("access-control-allow-methods") ?? "",
    /PATCH/,
  );
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "content-type, if-match, x-request-id",
  );
  assert.equal(response.headers.get("access-control-max-age"), "600");
  assert.equal(
    response.headers.get("vary"),
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  );
});

test("preflight rejects methods and headers outside the baseline", () => {
  const methodRejected = evaluateCorsRequest(
    new Request("https://api.example.com/api/resource", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "TRACE",
      },
    }),
    policy,
  );
  const headerRejected = evaluateCorsRequest(
    new Request("https://api.example.com/api/resource", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.com",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "X-Unexpected-Header",
      },
    }),
    policy,
  );

  assert.deepEqual(methodRejected, {
    kind: "reject",
    reason: "method_not_allowed",
  });
  assert.deepEqual(headerRejected, {
    kind: "reject",
    reason: "header_not_allowed",
  });
});

test("cross-origin response headers preserve existing response metadata", () => {
  const decision = evaluateCorsRequest(
    new Request("https://api.example.com/api/resource", {
      headers: { Origin: "https://app.example.com" },
    }),
    policy,
  );
  const source = new Response("ok", {
    status: 200,
    headers: {
      etag: '"v2"',
      "set-cookie": "session=opaque; Path=/; HttpOnly; Secure; SameSite=Lax",
      vary: "Accept-Encoding",
      "x-request-id": "req-cors-1",
    },
  });

  const response = applyCorsResponseHeaders(source, decision);

  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://app.example.com",
  );
  assert.equal(
    response.headers.get("access-control-allow-credentials"),
    "true",
  );
  assert.equal(response.headers.get("vary"), "Accept-Encoding, Origin");
  assert.equal(response.headers.get("etag"), '"v2"');
  assert.equal(response.headers.get("x-request-id"), "req-cors-1");
  assert.match(response.headers.get("set-cookie") ?? "", /session=opaque/);
});

test("same-origin responses do not get unnecessary CORS response headers", () => {
  const decision = evaluateCorsRequest(
    new Request("https://api.example.com/api/resource", {
      headers: { Origin: "https://api.example.com" },
    }),
    policy,
  );
  const response = applyCorsResponseHeaders(new Response("ok"), decision);

  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
});
