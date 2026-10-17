import assert from "node:assert/strict";
import test from "node:test";
import { probeD1Bookmark } from "../scripts/d1-bookmark-readonly-probe.mjs";
const config = { accountId: "a".repeat(32), databaseId: "f1ce1268-2be2-4a20-ab10-a94c32feee64", token: "fixture-secret" };
test("#431 only GET bookmark and never exposes bookmark or token", async () => {
  let calls = 0;
  const result = await probeD1Bookmark({ ...config, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(options.method, "GET");
    assert.equal(url.pathname.endsWith("/time_travel/bookmark"), true);
    assert.equal(options.headers.Authorization, "Bearer fixture-secret");
    return { ok: true, json: async () => ({ success: true, result: { bookmark: "private-bookmark" } }) };
  } });
  assert.deepEqual(result, { status: "AVAILABLE", provesRecoverability: false });
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-bookmark|fixture-secret/);
});
test("#431 failed/malformed responses never imply recoverability", async () => {
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ success: true }) }]) {
    assert.deepEqual(await probeD1Bookmark({ ...config, fetchImpl: async () => response }),
      { status: "UNAVAILABLE", provesRecoverability: false });
  }
  assert.deepEqual(await probeD1Bookmark({ ...config, fetchImpl: async () => { throw Error("secret"); } }),
    { status: "UNAVAILABLE", provesRecoverability: false });
});
test("#431 rejects malformed identifiers before any HTTP", async () => {
  await assert.rejects(() => probeD1Bookmark({ ...config, databaseId: "../restore", fetchImpl: async () => { throw Error("must not call"); } }));
});
