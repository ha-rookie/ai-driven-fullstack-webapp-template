import assert from "node:assert/strict";
import test from "node:test";

import {
  EnvironmentFeatureFlagProvider,
  FeatureFlagError,
  RuntimeConfigReader,
  createEnvironmentFeatureFlagProvider,
  defineFeatureFlags,
  toFeatureFlagSettingKey,
} from "../src/shared/runtime";

const definitions = defineFeatureFlags({
  example_feature: {},
  default_on_feature: { defaultValue: true },
});

test("known missing flags use their explicit default and default to false", () => {
  const provider = createEnvironmentFeatureFlagProvider({
    environment: "preview",
    config: new RuntimeConfigReader(),
    definitions,
  });

  assert.equal(provider.isEnabled("example_feature"), false);
  assert.equal(provider.isEnabled("default_on_feature"), true);
  assert.deepEqual(provider.evaluate("example_feature"), {
    key: "example_feature",
    environment: "preview",
    enabled: false,
    source: "default",
    settingKey: "FEATURE_FLAG__PREVIEW__EXAMPLE_FEATURE",
  });
});

test("preview and production read different configuration keys without fallback", () => {
  const config = new RuntimeConfigReader({
    settings: {
      FEATURE_FLAG__PREVIEW__EXAMPLE_FEATURE: "true",
      FEATURE_FLAG__PRODUCTION__EXAMPLE_FEATURE: "false",
    },
  });

  const preview = new EnvironmentFeatureFlagProvider({
    environment: "preview",
    config,
    definitions,
  });
  const production = new EnvironmentFeatureFlagProvider({
    environment: "production",
    config,
    definitions,
  });

  assert.equal(preview.isEnabled("example_feature"), true);
  assert.equal(production.isEnabled("example_feature"), false);
  assert.equal(preview.evaluate("example_feature").source, "configured");
  assert.equal(production.evaluate("example_feature").source, "configured");
});

test("a preview value is never inherited by production when production is missing", () => {
  const config = new RuntimeConfigReader({
    settings: {
      FEATURE_FLAG__PREVIEW__EXAMPLE_FEATURE: "true",
    },
  });

  const production = createEnvironmentFeatureFlagProvider({
    environment: "production",
    config,
    definitions,
  });

  assert.equal(production.isEnabled("example_feature"), false);
  assert.equal(production.evaluate("example_feature").source, "default");
});

test("configured booleans accept surrounding whitespace and case only", () => {
  const provider = createEnvironmentFeatureFlagProvider({
    environment: "test",
    config: new RuntimeConfigReader({
      settings: {
        FEATURE_FLAG__TEST__EXAMPLE_FEATURE: " TRUE ",
      },
    }),
    definitions,
  });

  assert.equal(provider.isEnabled("example_feature"), true);
});

test("invalid configured values fail instead of silently enabling or disabling", () => {
  const provider = createEnvironmentFeatureFlagProvider({
    environment: "local",
    config: new RuntimeConfigReader({
      settings: {
        FEATURE_FLAG__LOCAL__EXAMPLE_FEATURE: "1",
      },
    }),
    definitions,
  });

  assert.throws(
    () => provider.isEnabled("example_feature"),
    (error: unknown) =>
      error instanceof FeatureFlagError && error.code === "invalid_value",
  );
});

test("unknown flag keys fail fast so typos do not become implicit flags", () => {
  const provider = createEnvironmentFeatureFlagProvider({
    environment: "local",
    config: new RuntimeConfigReader(),
    definitions,
  });

  assert.throws(
    () => provider.isEnabled("missing_feature" as keyof typeof definitions),
    (error: unknown) =>
      error instanceof FeatureFlagError && error.code === "unknown_key",
  );
});

test("flag keys use lower_snake_case and map deterministically to settings", () => {
  assert.equal(
    toFeatureFlagSettingKey("production", "example_feature"),
    "FEATURE_FLAG__PRODUCTION__EXAMPLE_FEATURE",
  );

  assert.throws(
    () => defineFeatureFlags({ "Example-Feature": {} }),
    (error: unknown) =>
      error instanceof FeatureFlagError && error.code === "invalid_key",
  );
});
