import assert from "node:assert/strict";
import test from "node:test";

import { Pbkdf2PasswordHasher } from "../src/worker/auth";

test("PBKDF2 verification treats NFC-equivalent Unicode passwords as the same input", async () => {
  const hasher = new Pbkdf2PasswordHasher({
    iterations: 1_000,
    unsafeAllowBelowRecommendedIterationsForTests: true,
  });
  const composed = "Café password phrase";
  const decomposed = "Cafe\u0301 password phrase";
  const encoded = await hasher.hash(composed);

  assert.equal((await hasher.verify(decomposed, encoded)).valid, true);
});
