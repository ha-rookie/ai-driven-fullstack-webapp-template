import assert from "node:assert/strict";
import test from "node:test";

import {
  RuntimeConfigError,
  RuntimeConfigReader,
  RuntimeEnvironmentError,
  createFixedClock,
  cryptoIdGenerator,
  isProductionEnvironment,
  parseRuntimeEnvironment,
  systemClock,
} from "../src/shared/runtime";

test("systemClock returns a valid current Date", () => {
  const before = Date.now();
  const now = systemClock.now();
  const after = Date.now();

  assert.ok(now instanceof Date);
  assert.ok(Number.isFinite(now.getTime()));
  assert.ok(now.getTime() >= before && now.getTime() <= after);
});

test("createFixedClock returns deterministic isolated Date values", () => {
  const clock = createFixedClock("2026-09-30T00:00:00.000Z");
  const first = clock.now();
  first.setUTCFullYear(2030);

  assert.equal(clock.now().toISOString(), "2026-09-30T00:00:00.000Z");
});

test("createFixedClock rejects invalid dates", () => {
  assert.throws(() => createFixedClock("not-a-date"), RangeError);
});

test("cryptoIdGenerator returns UUID values", () => {
  const first = cryptoIdGenerator.generate();
  const second = cryptoIdGenerator.generate();
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  assert.match(first, uuidPattern);
  assert.match(second, uuidPattern);
  assert.notEqual(first, second);
});

test("RuntimeConfigReader keeps setting and secret sources explicit", () => {
  const config = new RuntimeConfigReader({
    settings: {
      APP_NAME: "example",
      RETRY_COUNT: "3",
    },
    secrets: {
      API_TOKEN: "sensitive-token-value",
    },
  });

  assert.equal(config.requiredSetting("APP_NAME"), "example");
  assert.equal(config.optionalSetting("MISSING"), undefined);
  assert.equal(config.requiredPositiveIntegerSetting("RETRY_COUNT"), 3);
  assert.equal(config.requiredSecret("API_TOKEN"), "sensitive-token-value");
  assert.equal(config.optionalSecret("MISSING_SECRET"), undefined);
});

test("RuntimeConfigReader rejects missing or invalid values without exposing secret values", () => {
  const secretValue = "super-sensitive-secret";
  const config = new RuntimeConfigReader({
    settings: { RETRY_COUNT: "0" },
    secrets: { API_TOKEN: secretValue },
  });

  assert.throws(
    () => config.requiredSetting("MISSING_SETTING"),
    (error: unknown) =>
      error instanceof RuntimeConfigError &&
      error.key === "MISSING_SETTING" &&
      !error.message.includes(secretValue),
  );

  assert.throws(
    () => config.requiredPositiveIntegerSetting("RETRY_COUNT"),
    (error: unknown) =>
      error instanceof RuntimeConfigError &&
      error.key === "RETRY_COUNT" &&
      !error.message.includes("0"),
  );
});

test("runtime environment accepts only explicit supported environments", () => {
  assert.equal(parseRuntimeEnvironment("local"), "local");
  assert.equal(parseRuntimeEnvironment("test"), "test");
  assert.equal(parseRuntimeEnvironment("preview"), "preview");
  assert.equal(parseRuntimeEnvironment("production"), "production");
  assert.equal(isProductionEnvironment("production"), true);
  assert.equal(isProductionEnvironment("preview"), false);

  assert.throws(
    () => parseRuntimeEnvironment("prod"),
    RuntimeEnvironmentError,
  );
  assert.throws(() => parseRuntimeEnvironment(undefined), RuntimeEnvironmentError);
});
