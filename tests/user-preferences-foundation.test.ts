import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveUserPreferences,
  validateUserPreferencePatch,
  type UserPreferencePolicy,
  type UserPreferenceValues,
} from "../src/shared/user-preferences";
import {
  InMemoryUserPreferencesStore,
  UserPreferenceConflictError,
} from "../src/shared/in-memory-user-preferences-store";

const policy: UserPreferencePolicy = {
  locale: { allowed: ["ja-JP", "en-US"], projectDefault: "ja-JP", systemDefault: "en-US" },
  timezone: {
    allowed: ["Asia/Tokyo", "America/New_York", "UTC"],
    projectDefault: "Asia/Tokyo", systemDefault: "UTC",
  },
  theme: { allowed: ["light", "dark", "system"], projectDefault: "light", systemDefault: "system" },
};

test("authenticated preferences override browser signals and defaults with explicit source", () => {
  const result = resolveUserPreferences({
    policy, authenticated: true,
    user: { locale: "en-US", timezone: "America/New_York", theme: "dark" },
    device: { locale: "ja-JP", timezone: "Asia/Tokyo", prefersDark: false },
  });
  assert.deepEqual(result, {
    locale: "en-US", timezone: "America/New_York", theme: "dark", colorScheme: "dark",
    source: { locale: "user", timezone: "user", theme: "user" },
  });
});

test("unauthenticated callers cannot read or apply provided user preferences", () => {
  const result = resolveUserPreferences({
    policy, authenticated: false, user: { locale: "en-US", theme: "light" },
    device: { locale: "ja-JP", timezone: "Asia/Tokyo", prefersDark: true },
  });
  assert.equal(result.locale, "ja-JP");
  assert.equal(result.colorScheme, "dark");
  assert.equal(result.source.locale, "device");
  assert.equal(result.source.theme, "device");
});

test("forced policy overrides the saved preference and browser", () => {
  const forcedPolicy: UserPreferencePolicy = {
    ...policy,
    timezone: { ...policy.timezone, forced: "Asia/Tokyo" },
    theme: { ...policy.theme, forced: "light" },
  };
  const result = resolveUserPreferences({
    policy: forcedPolicy, authenticated: true,
    user: { timezone: "America/New_York", theme: "dark" },
    device: { timezone: "UTC", prefersDark: true },
  });
  assert.equal(result.timezone, "Asia/Tokyo");
  assert.equal(result.theme, "light");
  assert.equal(result.source.timezone, "forced");
  assert.equal(result.source.theme, "forced");
});

test("unsupported saved/browser values fall back to policy defaults", () => {
  const result = resolveUserPreferences({
    policy, authenticated: true,
    user: { locale: "fr-FR", timezone: "Mars/Colony" },
    device: { locale: "de-DE", timezone: "Europe/Paris" },
  });
  assert.equal(result.locale, "ja-JP");
  assert.equal(result.timezone, "Asia/Tokyo");
  assert.equal(result.source.locale, "project");
  assert.equal(result.source.timezone, "project");
});

test("system defaults are used if neither device nor project has a valid candidate", () => {
  const p: UserPreferencePolicy = {
    locale: { allowed: ["en-US"], projectDefault: "fr-FR", systemDefault: "en-US" },
    timezone: { allowed: ["UTC"], systemDefault: "UTC" },
    theme: { allowed: ["system"], systemDefault: "system" },
  };
  const result = resolveUserPreferences({ policy: p, authenticated: false });
  assert.equal(result.locale, "en-US");
  assert.equal(result.timezone, "UTC");
  assert.equal(result.theme, "system");
  assert.equal(result.colorScheme, "light");
  assert.deepEqual(result.source, { locale: "system", timezone: "system", theme: "system" });
});

test("unset theme and explicit system choice differ; OS changes keep system choice", () => {
  const unset = resolveUserPreferences({
    policy, authenticated: true, user: { theme: null }, device: { prefersDark: true },
  });
  assert.equal(unset.theme, "dark");
  assert.equal(unset.source.theme, "device");
  const dark = resolveUserPreferences({
    policy, authenticated: true, user: { theme: "system" }, device: { prefersDark: true },
  });
  const light = resolveUserPreferences({
    policy, authenticated: true, user: { theme: "system" }, device: { prefersDark: false },
  });
  assert.equal(dark.theme, "system");
  assert.equal(dark.colorScheme, "dark");
  assert.equal(light.theme, "system");
  assert.equal(light.colorScheme, "light");
  assert.equal(dark.source.theme, "user");
});

test("malformed forced policy or system fallback is rejected, not silently ignored", () => {
  assert.throws(() => resolveUserPreferences({
    policy: { ...policy, theme: { ...policy.theme, forced: "opaque" as "dark" } },
    authenticated: false,
  }), /policy.theme.forced/);
  assert.throws(() => resolveUserPreferences({
    policy: { ...policy, timezone: { ...policy.timezone, systemDefault: "No/Such_Zone" } },
    authenticated: false,
  }), /policy.timezone.systemDefault/);
});

test("patch allows null unset, rejects unknown fields and unsupported locales/timezones/theme", () => {
  assert.deepEqual(validateUserPreferencePatch({ theme: null, locale: "en-US" }, policy), {
    theme: null, locale: "en-US",
  });
  for (const bad of [
    { theme: "red" }, { locale: "fr-FR" }, { timezone: "Etc/Not_A_Zone" },
    { token: "secret" }, { authorization: "admin" }, { theme: undefined }, {},
  ]) {
    assert.throws(() => validateUserPreferencePatch(bad, policy), /Invalid preference/);
  }
});

test("store separates users and environments, preserves version and never returns a mutable internal record", async () => {
  const store = new InMemoryUserPreferencesStore();
  const a = await store.update({
    userId: "aoi", environment: "preview", expectedVersion: 0,
    patch: { locale: "en-US", timezone: "Asia/Tokyo", theme: "system" },
  }, policy);
  assert.equal(a.version, 1);
  assert.equal(a.schemaVersion, 1);
  assert.equal(a.theme, "system");
  assert.ok(!Number.isNaN(Date.parse(a.updatedAt)));
  assert.equal(await store.get("ren", "preview"), null);
  assert.equal(await store.get("aoi", "production"), null);
  assert.deepEqual(await store.get("aoi", "preview"), a);
  // Another device using the same shared server adapter observes the same record.
  const fromDeviceB = await store.get("aoi", "preview");
  assert.equal(fromDeviceB?.locale, "en-US");
  const next = await store.update({
    userId: "aoi", environment: "preview", expectedVersion: fromDeviceB!.version,
    patch: { theme: "dark" },
  }, policy);
  assert.equal(next.version, 2);
  assert.equal(next.locale, "en-US");
  assert.equal(next.theme, "dark");
  assert.equal(a.theme, "system");
});

test("stale version, missing resource and duplicate first-create fail before modifying state", async () => {
  const store = new InMemoryUserPreferencesStore();
  const input = { userId: "aoi", environment: "test" as const, expectedVersion: 0, patch: { theme: "dark" as const } };
  await assert.rejects(store.update({ ...input, expectedVersion: 1 }, policy),
    (e: unknown) => e instanceof UserPreferenceConflictError && e.reason === "not_found");
  await store.update(input, policy);
  await assert.rejects(store.update(input, policy),
    (e: unknown) => e instanceof UserPreferenceConflictError && e.reason === "version_conflict");
  const before = await store.get("aoi", "test");
  await assert.rejects(store.update({ ...input, expectedVersion: -1 }, policy), /expectedVersion/);
  assert.deepEqual(await store.get("aoi", "test"), before);
});

test("rejected secret or invalid patch never persists or bumps the version", async () => {
  const store = new InMemoryUserPreferencesStore();
  await store.update({
    userId: "aoi", environment: "local", expectedVersion: 0, patch: { theme: "dark" },
  }, policy);
  const before = await store.get("aoi", "local");
  await assert.rejects(store.update({
    userId: "aoi", environment: "local", expectedVersion: 1,
    patch: { theme: "light", credential: "should-not-save" } as unknown as UserPreferenceValues,
  }, policy), /Invalid preference: credential/);
  await assert.rejects(store.update({
    userId: "aoi", environment: "local", expectedVersion: 1,
    patch: { timezone: "Invalid/Zone" },
  }, policy), /Invalid preference: timezone/);
  assert.deepEqual(await store.get("aoi", "local"), before);
});
