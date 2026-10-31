import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import DeveloperGuideOverview from "../src/reference/workhub/DeveloperGuideOverview";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthProvider } from "../src/frontend/auth/context";
import { createAuthApiLoader, createAuthController, type AuthController } from "../src/frontend/auth/state";
import { ApiClientError } from "../src/frontend/api";
import { runSafeMutation } from "../src/frontend/mutation";
import {
  createWorkhubPreferenceMutation,
  readWorkhubDeviceSignals,
  resolveWorkhubPreferencePreview,
  UserPreferencesProvider,
  useUserPreferences,
} from "../src/frontend/preferences/context";

const PreferenceConsumer = () => {
  const { resolved, sourceOfTruth, authenticated } = useUserPreferences();
  return createElement("output", {
    "data-authenticated": authenticated ? "yes" : "no",
    "data-locale": resolved.locale,
    "data-timezone": resolved.timezone,
    "data-theme": resolved.theme,
    "data-color-scheme": resolved.colorScheme,
    "data-locale-source": resolved.source.locale,
    "data-source-of-truth": sourceOfTruth,
  }, "reference only");
};

const renderWithAuth = (controller: AuthController): string =>
  renderToStaticMarkup(createElement(
    AuthProvider, { controller },
    createElement(
      UserPreferencesProvider, null,
      createElement(Fragment, null,
        createElement(PreferenceConsumer),
        createElement(PreferenceConsumer),
      ),
    ),
  ));

test("WORKHUB shell gives two React consumers the same resolved preference reference without saved-user claims", async () => {
  const controller = createAuthController(async () => ({ id: "aoi", displayName: "Aoi" }));
  await controller.bootstrap();
  const html = renderWithAuth(controller);
  assert.equal((html.match(/data-source-of-truth="device-and-project-defaults-only"/g) ?? []).length, 2);
  assert.equal((html.match(/data-authenticated="yes"/g) ?? []).length, 2);
  const locale = [...html.matchAll(/data-locale="([^"]+)"/g)].map(m => m[1]);
  const timezone = [...html.matchAll(/data-timezone="([^"]+)"/g)].map(m => m[1]);
  assert.equal(locale.length, 2);
  assert.equal(locale[0], locale[1]);
  assert.equal(timezone.length, 2);
  assert.equal(timezone[0], timezone[1]);
  assert.ok(["ja-JP", "en-US"].includes(locale[0]));
  assert.ok(["UTC", "Asia/Tokyo", "America/New_York"].includes(timezone[0]));
  assert.doesNotMatch(html, /workhub-demo|aoi|token|password|credential/i);
});

test("logout changes authenticated context without retaining user preference data", async () => {
  const controller = createAuthController(async () => ({ id: "aoi", displayName: "Aoi" }));
  await controller.bootstrap();
  assert.match(renderWithAuth(controller), /data-authenticated="yes"/);
  controller.resetAfterLogout();
  const afterLogout = renderWithAuth(controller);
  assert.equal((afterLogout.match(/data-authenticated="no"/g) ?? []).length, 2);
  assert.match(afterLogout, /data-source-of-truth="device-and-project-defaults-only"/);
  assert.doesNotMatch(afterLogout, /aoi|credential|password/);
});

test("unauthenticated server 401 is separate from a preference load error", async () => {
  const controller = createAuthController(createAuthApiLoader(async () =>
    new Response(null, { status: 401 })));
  await controller.bootstrap();
  assert.equal(controller.getSnapshot().status, "unauthenticated");
  assert.match(renderWithAuth(controller), /data-authenticated="no"/);
});

test("browser signal reading is optional and uses supported bounded values", () => {
  const signals = readWorkhubDeviceSignals();
  assert.ok(signals.locale === undefined || ["ja-JP", "en-US"].includes(signals.locale));
  assert.ok(signals.timezone === undefined || typeof signals.timezone === "string");
  assert.ok(signals.prefersDark === undefined || typeof signals.prefersDark === "boolean");
});

test("reading preference context without a shell provider fails explicitly", () => {
  assert.throws(() => renderToStaticMarkup(createElement(PreferenceConsumer)),
    /useUserPreferences must be used within UserPreferencesProvider/);
});


test("unsaved locale/timezone/theme preview uses the shared resolver and reports its user-layer provenance", () => {
  const resolved = resolveWorkhubPreferencePreview(
    "demo-aoi",
    { userId: "demo-aoi", values: { locale: "en-US", timezone: "UTC", theme: "dark" } },
    { locale: "ja-JP", timezone: "Asia/Tokyo", prefersDark: false },
  );
  assert.equal(resolved.locale, "en-US");
  assert.equal(resolved.timezone, "UTC");
  assert.equal(resolved.theme, "dark");
  assert.equal(resolved.colorScheme, "dark");
  assert.deepEqual(resolved.source, { locale: "user", timezone: "user", theme: "user" });
});

test("a session preview cannot carry over to a different authenticated user or logged-out state", () => {
  const preview = { userId: "demo-aoi", values: { theme: "dark" as const } };
  const device = { locale: "ja-JP", timezone: "Asia/Tokyo", prefersDark: false };
  const own = resolveWorkhubPreferencePreview("demo-aoi", preview, device);
  const other = resolveWorkhubPreferencePreview("demo-ren", preview, device);
  const loggedOut = resolveWorkhubPreferencePreview(null, preview, device);
  assert.equal(own.theme, "dark");
  assert.equal(other.theme, "light");
  assert.equal(loggedOut.theme, "light");
  assert.equal(other.source.theme, "device");
  assert.equal(loggedOut.source.theme, "device");
});

test("unset preview falls back to OS; explicit system follows OS but remains a user-layer choice", () => {
  const light = { locale: "ja-JP", timezone: "Asia/Tokyo", prefersDark: false };
  const dark = { ...light, prefersDark: true };
  const unset = resolveWorkhubPreferencePreview("demo-aoi", { userId: "demo-aoi", values: { theme: null } }, dark);
  assert.equal(unset.theme, "dark");
  assert.equal(unset.source.theme, "device");
  const osLight = resolveWorkhubPreferencePreview("demo-aoi", { userId: "demo-aoi", values: { theme: "system" } }, light);
  const osDark = resolveWorkhubPreferencePreview("demo-aoi", { userId: "demo-aoi", values: { theme: "system" } }, dark);
  assert.equal(osLight.theme, "system");
  assert.equal(osLight.colorScheme, "light");
  assert.equal(osDark.colorScheme, "dark");
  assert.equal(osDark.source.theme, "user");
});

test("WORKHUB Developer Guide exposes labeled selectors, reset action and a local-only sample", async () => {
  const controller = createAuthController(async () => ({ id: "demo-aoi", displayName: "Demo" }));
  await controller.bootstrap();
  const html = renderToStaticMarkup(createElement(
    AuthProvider, { controller },
    createElement(UserPreferencesProvider, null,
      createElement(DeveloperGuideOverview, { locale: "ja-JP", onOpenScreen: () => {} }),
    ),
  ));
  for (const id of ["workhub-preference-preview-locale", "workhub-preference-preview-timezone", "workhub-preference-preview-theme"]) {
    assert.ok(html.includes(`id="${id}"`), `missing selector ${id}`);
    assert.ok(html.includes(`htmlFor="${id}"`) || html.includes(`for="${id}"`));
  }
  assert.match(html, /設定プレビュー/);
  assert.match(html, /保存されません/);
  assert.match(html, /プレビューを初期化/);
  assert.match(html, /data-preview-scheme="(?:light|dark)"/);
  assert.match(html, /2026/);
  assert.doesNotMatch(html, /localStorage|シークレット保存/);
});


test("WORKHUB preference editing reuses #155 clean/dirty/version and skips unchanged submissions", async () => {
  const mutation = createWorkhubPreferenceMutation({
    version: 3, values: { locale: "ja-JP", timezone: "Asia/Tokyo", theme: "system" },
  });
  const snapshot = mutation.getSnapshot();
  assert.equal(snapshot.phase, "clean");
  assert.deepEqual(await runSafeMutation(mutation, async () => {
    throw new Error("clean must not submit");
  }), { status: "skipped", reason: "clean" });

  mutation.setDraft({
    version: snapshot.persisted.version,
    values: { ...snapshot.draft.values, theme: "dark" },
  });
  assert.equal(mutation.getSnapshot().phase, "dirty");
  let sentVersion: string | number | undefined;
  let sentTheme: string | null | undefined;
  let finish!: (saved: { version: number; values: typeof snapshot.persisted.values }) => void;
  const pending = runSafeMutation(mutation, async ({ draft, expectedVersion }) => {
    sentVersion = expectedVersion;
    sentTheme = draft.values.theme;
    return new Promise<{ version: number; values: typeof snapshot.persisted.values }>(resolve => { finish = resolve; });
  });
  assert.equal(mutation.getSnapshot().phase, "submitting");
  assert.deepEqual(await runSafeMutation(mutation, async () => {
    throw new Error("duplicate must not submit");
  }), { status: "skipped", reason: "submitting" });
  assert.equal(sentVersion, 3);
  assert.equal(sentTheme, "dark");
  finish({ version: 4, values: { ...snapshot.persisted.values, theme: "dark" } });
  assert.equal((await pending).status, "success");
  assert.equal(mutation.getSnapshot().phase, "success");
  assert.equal(mutation.getSnapshot().persisted.version, 4);

  mutation.setDraft({ ...mutation.getSnapshot().persisted, values: {
    locale: "ja-JP", timezone: "Asia/Tokyo", theme: "dark",
  } });
  assert.equal(mutation.getSnapshot().phase, "clean");
});

test("WORKHUB preference conflict keeps the draft and shared #155 state permits reload/re-edit", async () => {
  const mutation = createWorkhubPreferenceMutation({
    version: 7, values: { locale: "ja-JP", timezone: "Asia/Tokyo", theme: "light" },
  });
  mutation.setDraft({
    version: 7, values: { locale: "en-US", timezone: "Asia/Tokyo", theme: "light" },
  });
  const conflict = await runSafeMutation(mutation, async () => {
    throw new ApiClientError("http", "Conflict", { status: 409 });
  }, { loadLatest: async () => ({
    version: 8, values: { locale: "ja-JP", timezone: "UTC", theme: "dark" as const },
  }) });
  assert.equal(conflict.status, "conflict");
  assert.equal(mutation.getSnapshot().phase, "conflict");
  assert.equal(mutation.getSnapshot().persisted.version, 8);
  assert.equal(mutation.getSnapshot().draft.values.locale, "en-US");
  assert.deepEqual(await runSafeMutation(mutation, async () => {
    throw new Error("conflicting draft must not auto-submit");
  }), { status: "skipped", reason: "conflict" });
  mutation.acceptLatest(mutation.getSnapshot().persisted);
  assert.equal(mutation.getSnapshot().phase, "clean");
  assert.equal(mutation.getSnapshot().draft.values.timezone, "UTC");
  mutation.setDraft({ version: 8, values: {
    locale: "en-US", timezone: "UTC", theme: "dark",
  } });
  assert.equal(mutation.getSnapshot().phase, "dirty");
});

test("WORKHUB preference failed request retains draft for explicit retry", async () => {
  const mutation = createWorkhubPreferenceMutation({
    version: 1, values: { locale: null, timezone: null, theme: null },
  });
  mutation.setDraft({ version: 1, values: { locale: "en-US", timezone: null, theme: null } });
  assert.equal((await runSafeMutation(mutation, async () => {
    throw new Error("Local D1 unavailable");
  })).status, "failed");
  assert.equal(mutation.getSnapshot().phase, "failed");
  assert.equal(mutation.getSnapshot().draft.values.locale, "en-US");
  assert.equal((await runSafeMutation(mutation, async ({ expectedVersion, draft }) => {
    assert.equal(expectedVersion, 1);
    return { version: 2, values: draft.values };
  })).status, "success");
  assert.equal(mutation.getSnapshot().phase, "success");
});

test("WORKHUB preference selectors are labeled and block saving while loading", async () => {
  const controller = createAuthController(async () => ({ id: "demo-aoi", displayName: "Demo" }));
  await controller.bootstrap();
  const html = renderToStaticMarkup(createElement(
    AuthProvider, { controller },
    createElement(UserPreferencesProvider, null,
      createElement(DeveloperGuideOverview, { locale: "ja-JP", onOpenScreen: () => {} }),
    ),
  ));
  assert.equal((html.match(/<select[^>]*disabled=""/g) ?? []).length, 3);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /設定を保存/);
});
