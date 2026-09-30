import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applySecurityHeaders,
  BASE_SECURITY_HEADERS,
  CONTENT_SECURITY_POLICY,
  HSTS_HEADER_VALUE,
} from "../src/worker/http";

const httpsRequest = new Request("https://example.test/api/resource");
const httpRequest = new Request("http://localhost:5173/api/resource");

test("HTTPS API responses receive the security baseline without losing existing headers", async () => {
  const source = new Response("ok", {
    status: 201,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": "session=opaque; Path=/; HttpOnly; Secure; SameSite=Lax",
      etag: '"v3"',
      "x-request-id": "req-security-1",
    },
  });

  const response = applySecurityHeaders(source, httpsRequest);

  assert.equal(response.status, 201);
  assert.equal(await response.text(), "ok");
  assert.equal(
    response.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.equal(response.headers.get("etag"), '"v3"');
  assert.equal(response.headers.get("x-request-id"), "req-security-1");
  assert.match(response.headers.get("set-cookie") ?? "", /session=opaque/);

  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    assert.equal(response.headers.get(name), value);
  }
  assert.equal(
    response.headers.get("strict-transport-security"),
    HSTS_HEADER_VALUE,
  );
});

test("HTTP/local API responses do not emit HSTS", () => {
  const source = new Response(null, {
    status: 204,
    headers: { "strict-transport-security": "max-age=999" },
  });

  const response = applySecurityHeaders(source, httpRequest);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("strict-transport-security"), null);
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    assert.equal(response.headers.get(name), value);
  }
});

test("CSP baseline stays self-origin and avoids unsafe execution allowances", () => {
  assert.match(CONTENT_SECURITY_POLICY, /default-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-eval/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /\*/);
});

test("Cloudflare static asset _headers stays synchronized with the API baseline", async () => {
  const staticHeaders = (await readFile("public/_headers", "utf8")).toLowerCase();

  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    assert.match(
      staticHeaders,
      new RegExp(
        `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ${value
          .toLowerCase()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  }

  assert.match(
    staticHeaders,
    new RegExp(`strict-transport-security: ${HSTS_HEADER_VALUE}`),
  );
  assert.doesNotMatch(staticHeaders, /includesubdomains/);
  assert.doesNotMatch(staticHeaders, /preload/);
});
