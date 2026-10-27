import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthProvider } from "../src/frontend/auth/context";
import { createAuthApiLoader, createAuthController, type AuthController } from "../src/frontend/auth/state";
import {
  readWorkhubDeviceSignals,
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
