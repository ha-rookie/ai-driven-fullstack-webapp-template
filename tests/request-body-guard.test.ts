import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  readJsonBody,
} from "../src/worker/http";

const request = (
  body: BodyInit | null,
  headers: HeadersInit = { "content-type": "application/json" },
) =>
  new Request("https://example.test/api/resource", {
    method: "POST",
    headers,
    body,
  });

test("valid application/json is parsed", async () => {
  const result = await readJsonBody(request('{"name":"Example"}'));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { name: "Example" });
  assert.ok(result.bytesRead > 0);
});

test("application/json parameters are accepted", async () => {
  const result = await readJsonBody(
    request('{"name":"Example"}', {
      "content-type": "Application/JSON; charset=utf-8",
    }),
  );

  assert.equal(result.ok, true);
});

test("missing and unsupported content types fail with 415", async () => {
  const missing = await readJsonBody(request("{}", {}));
  const unsupported = await readJsonBody(
    request("{}", { "content-type": "text/plain" }),
  );

  assert.deepEqual(missing, {
    ok: false,
    status: 415,
    code: "unsupported_media_type",
    message: "Content-Type must be application/json",
  });
  assert.deepEqual(unsupported, missing);
});

test("malformed and empty JSON fail with 400", async () => {
  const malformed = await readJsonBody(request('{"name":'));
  const empty = await readJsonBody(request(""));

  for (const result of [malformed, empty]) {
    assert.deepEqual(result, {
      ok: false,
      status: 400,
      code: "malformed_json",
      message: "Request body must contain valid JSON",
    });
  }
});

test("declared oversized content length fails before parsing", async () => {
  const result = await readJsonBody(
    request("{}", {
      "content-type": "application/json",
      "content-length": String(DEFAULT_JSON_BODY_LIMIT_BYTES + 1),
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    status: 413,
    code: "payload_too_large",
    message: "Request body exceeds the allowed size",
  });
});

test("actual streamed bytes are capped even without a trusted content length", async () => {
  const result = await readJsonBody(
    request('{"value":"0123456789"}'),
    { maxBytes: 8 },
  );

  assert.deepEqual(result, {
    ok: false,
    status: 413,
    code: "payload_too_large",
    message: "Request body exceeds the allowed size",
  });
});

test("parsed JSON shape is left to the endpoint", async () => {
  const result = await readJsonBody(request("[1,2,3]"));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, [1, 2, 3]);
});

test("invalid configured maxBytes fails as a programming error", async () => {
  await assert.rejects(
    () => readJsonBody(request("{}"), { maxBytes: 0 }),
    /request_body_guard_invalid_max_bytes/,
  );
});
