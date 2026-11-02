import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorkhubThemeSurface, themeSelectionPatch, themeSelectionValue,
} from "../src/reference/workhub/ThemeReferencePanel";
import {
  resolveUserPreferences, workhubUserPreferencePolicy,
} from "../src/shared/user-preferences";

test("#290 WORKHUB theme surface uses #288 resolved preference without a new store", () => {
  for (const [choice, osDark, expected] of [
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["system", true, "dark"],
    ["system", false, "light"],
  ] as const) {
    const resolved = resolveUserPreferences({
      policy: workhubUserPreferencePolicy, authenticated: true,
      user: { theme: choice }, device: { prefersDark: osDark },
    });
    const html = renderToStaticMarkup(createElement(WorkhubThemeSurface, { resolved },
      createElement("output", null, "WORKHUB")));
    assert.match(html, new RegExp('data-theme="' + expected + '"'));
    assert.match(html, new RegExp('data-theme-mode="' + choice + '"'));
    assert.match(html, /data-theme-source="user"/);
    assert.match(html, />WORKHUB<\/output>/);
  }
});

test("#290 explicit system and unset remain distinguishable in the selection action", () => {
  assert.equal(themeSelectionValue(null), "");
  assert.equal(themeSelectionPatch(""), null);
  assert.equal(themeSelectionPatch("system"), "system");
  assert.equal(themeSelectionPatch("light"), "light");
  assert.equal(themeSelectionPatch("dark"), "dark");
  assert.throws(() => themeSelectionPatch("untrusted"), /Invalid preference: theme/);
});

test("#290 unauthenticated fallback follows OS without retaining a previous user's saved theme", () => {
  const resolved = resolveUserPreferences({
    policy: workhubUserPreferencePolicy,
    authenticated: false,
    user: { theme: "dark" },
    device: { prefersDark: false },
  });
  const html = renderToStaticMarkup(createElement(WorkhubThemeSurface, { resolved },
    createElement("span", null, "public login")));
  assert.match(html, /data-theme="light"/);
  assert.doesNotMatch(html, /data-theme-source="user"/);
  assert.doesNotMatch(html, /data-theme-mode="dark"/);
});
