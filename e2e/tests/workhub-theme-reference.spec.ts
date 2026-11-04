import { expect, test } from "@playwright/test";

test("#290 saved theme + OS system switch preserves WORKHUB session, draft and request budget", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  // #290 Slice B: login uses the current OS signal, never the previous user's theme.
  const loginSurface = page.locator(".workhub-theme-scope");
  await expect(loginSurface).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".workhub-login-card h2")).toHaveCSS("color", "rgb(238, 244, 248)");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const panel = page.locator("#workhub-theme-reference");
  const choice = panel.getByRole("combobox", { name: "表示テーマ" });
  const surface = page.locator(".workhub-theme-scope");
  const purpose = page.getByRole("textbox", { name: "目的", exact: true });
  await expect(choice).toBeEnabled();
  const originalSelection = await choice.inputValue();
  const originalUrl = page.url();
  await purpose.fill("unsaved-business-draft-290");

  const calls: string[] = [];
  page.on("request", req => {
    const path = new URL(req.url()).pathname;
    if (path === "/api/me/preferences") calls.push(req.method() + " " + path);
    if (req.method() !== "GET" && path.startsWith("/api/workhub/"))
      calls.push("UNEXPECTED BUSINESS MUTATION " + path);
  });

  await choice.selectOption("dark");
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(panel.getByRole("status")).toContainText("未保存のプレビュー");
  await expect(purpose).toHaveValue("unsaved-business-draft-290");
  expect(calls).toEqual([]);
  expect(page.url()).toBe(originalUrl);

  const firstSave = page.waitForResponse(res =>
    new URL(res.url()).pathname === "/api/me/preferences" && res.request().method() === "PATCH");
  await panel.getByRole("button", { name: "表示設定を保存" }).click();
  expect((await firstSave).status()).toBe(200);
  await expect(panel.getByRole("status")).toHaveText("表示設定を保存しました");
  await expect(surface).toHaveAttribute("data-theme-source", "user");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(surface).toHaveAttribute("data-theme", "dark");

  await choice.selectOption("system");
  await expect(surface).toHaveAttribute("data-theme-mode", "system");
  await expect(surface).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(surface).toHaveAttribute("data-theme", "dark");
  const systemSave = page.waitForResponse(res =>
    new URL(res.url()).pathname === "/api/me/preferences" && res.request().method() === "PATCH");
  await panel.getByRole("button", { name: "表示設定を保存" }).click();
  expect((await systemSave).status()).toBe(200);
  expect(calls).toEqual(["PATCH /api/me/preferences", "PATCH /api/me/preferences"]);
  await expect(purpose).toHaveValue("unsaved-business-draft-290");
  expect(page.url()).toBe(originalUrl);

  await page.reload();
  await expect(choice).toBeEnabled();
  await expect(choice).toHaveValue("system");
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toHaveCount(0);

  // Restore the original saved preference for the remaining shared browser scenarios.
  if (originalSelection !== "system") {
    await choice.selectOption(originalSelection);
    const restore = page.waitForResponse(res =>
      new URL(res.url()).pathname === "/api/me/preferences" && res.request().method() === "PATCH");
    await panel.getByRole("button", { name: "表示設定を保存" }).click();
    expect((await restore).status()).toBe(200);
  }
  expect(calls.some(call => call.startsWith("UNEXPECTED BUSINESS MUTATION"))).toBe(false);
});


test("#290 bootstrap waits for the server theme before mounting protected UI and clears it on logout", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  // Synthetic only: no persisted test-user changes, no extra API or custom storage.
  let releasePreference!: () => void;
  const preferenceGate = new Promise<void>(resolve => { releasePreference = resolve; });
  const preferenceMethods: string[] = [];
  await page.route("**/api/me/preferences", async route => {
    const method = route.request().method();
    preferenceMethods.push(method);
    if (method !== "GET") return route.continue();
    await preferenceGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, version: 4, values: { theme: "light" } }),
    });
  });

  await page.goto("/");
  const surface = page.locator(".workhub-theme-scope");
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.locator(".workhub-loading")).toContainText("表示設定を確認しています…");
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".workhub-home-shell")).toHaveCount(0);
  await expect(page.locator("#workhub-travel-form")).toHaveCount(0);
  expect(preferenceMethods).toContain("GET");
  expect(preferenceMethods).not.toContain("PATCH");

  releasePreference();
  await expect(surface).toHaveAttribute("data-theme", "light");
  await expect(surface).toHaveAttribute("data-theme-source", "user");
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  expect(preferenceMethods).not.toContain("PATCH");

  await page.getByRole("button", { name: "ログアウトして別のユーザーでログイン" }).click();
  await expect(page.getByRole("heading", { name: "WORKHUBにログイン" })).toBeVisible();
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(surface).not.toHaveAttribute("data-theme-source", "user");
  await expect(page.locator(".workhub-login-card h2")).toHaveCSS("color", "rgb(238, 244, 248)");

  // A new identity is not served the prior user's synthetic preferences.
  await page.unroute("**/api/me/preferences");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Ren Manager/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Ren Managerさん/u })).toBeVisible();
  expect(preferenceMethods).not.toContain("PATCH");
});

test("#290 unavailable preference GET retains authentication and safely recovers without business mutation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const methods: string[] = [];
  await page.route("**/api/me/preferences", async route => {
    methods.push(route.request().method());
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const warning = page.locator(".workhub-preferences-fallback");
  const surface = page.locator(".workhub-theme-scope");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("表示設定を取得できませんでした");
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  await expect(surface).toHaveAttribute("data-theme", "dark");
  await expect(surface).not.toHaveAttribute("data-theme-source", "user");
  await expect(page.getByRole("heading", { name: "ログイン状態を確認できません" })).toHaveCount(0);
  expect(methods).not.toContain("PATCH");

  await page.unroute("**/api/me/preferences");
  await warning.getByRole("button", { name: "表示設定を再読み込み" }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.locator("#workhub-theme-reference")
    .getByRole("combobox", { name: "表示テーマ" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();
  expect(methods).not.toContain("PATCH");
});


test("#290 Slice C: existing WORKHUB components follow semantic tokens and keyboard focus", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  // Existing login Persona dialog, not a synthetic application component.
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  const dialog = page.getByRole("dialog", { name: "デモユーザを選ぶ" });
  await expect(dialog).toHaveCSS("background-color", "rgb(29, 44, 59)");
  await expect(dialog.getByRole("heading", { name: "デモユーザを選ぶ" })).toBeVisible();
  await dialog.getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const theme = page.locator("#workhub-theme-reference");
  const choice = theme.getByRole("combobox", { name: "表示テーマ" });
  await expect(choice).toBeEnabled();
  const surface = page.locator(".workhub-theme-scope");
  await choice.selectOption("dark"); // unsaved preview only
  await expect(surface).toHaveAttribute("data-theme", "dark");
  // Actual branded Travel Form intentionally retains readable light controls.
  const form = page.locator("#workhub-travel-form");
  const purpose = form.getByRole("textbox", { name: "目的" });
  await expect(purpose).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(purpose).toHaveCSS("color", "rgb(23, 50, 67)");
  await expect(form.getByRole("combobox", { name: "行先" })).toBeVisible();

  // Project-side branding override is a CSS variable only; no persistence or API.
  await surface.evaluate(el => el instanceof HTMLElement &&
    el.style.setProperty("--workhub-project-brand-gradient",
      "linear-gradient(90deg, rgb(16, 50, 85), rgb(33, 75, 117))"));
  await expect(form).toHaveCSS("background-image", /rgb\(16, 50, 85\)/);

  // Inert CSS-state fixtures complement real Form/Dialog: no app or API mutation.
  await page.evaluate(() => {
    const host = document.querySelector(".workhub-home-shell");
    if (!host) throw new Error("expected WORKHUB home shell");
    const fixture = document.createElement("section");
    fixture.id = "theme-state-smoke";
    fixture.innerHTML = [
      '<div class="workhub-announcement-compose">',
      '<label>編集可<input id="theme-editable" value="編集可能"></label>',
      '<label>参照専用<input id="theme-readonly" readonly value="参照専用"></label>',
      '<label>操作不可<input id="theme-disabled" disabled value="操作不可"></label>',
      '</div>',
      '<div class="workhub-global-banner" role="alert">',
      '<h2>重要なお知らせ</h2><p>確認が必要です</p></div>',
      '<div class="workhub-return-reason" role="note"><strong>差戻し理由</strong><p>要修正</p></div>',
    ].join("");
    host.appendChild(fixture);
  });
  await expect(page.locator("#theme-editable")).toHaveCSS("background-color", "rgb(29, 44, 59)");
  await expect(page.locator("#theme-readonly")).toHaveCSS("border-top-style", "dashed");
  await expect(page.locator("#theme-disabled")).toBeDisabled();
  await expect(page.locator("#theme-disabled")).toHaveCSS("border-top-style", "dashed");
  const banner = page.locator("#theme-state-smoke [role=alert]");
  await expect(banner).toContainText("重要なお知らせ");
  await expect(banner).toHaveCSS("background-color", "rgb(67, 43, 50)");
  await expect(page.locator("#theme-state-smoke [role=note]")).toContainText("差戻し理由");

  // Reusing existing keyboard focus ring; no new accessibility framework.
  await choice.focus();
  await page.keyboard.press("Tab");
  const save = theme.getByRole("button", { name: "表示設定を保存" });
  await expect(save).toBeFocused();
  await expect(save).toHaveCSS("outline-style", "solid");
  await expect(save).toHaveCSS("outline-width", "3px");

  await choice.selectOption("light");
  await expect(surface).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#theme-editable")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(banner).toHaveCSS("background-color", "rgb(255, 240, 240)");
  await expect(purpose).toHaveCSS("background-color", "rgb(255, 255, 255)");
  // Do not persist this preview; subsequent test/browser session starts at server truth.
});

test("#290 Slice C: Admin Audit Table and named outcomes remain legible in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Kai Admin/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.goto("/admin");
  const shell = page.locator(".workhub-theme-scope");
  await expect(shell).toHaveAttribute("data-theme", "dark");
  const admin = page.locator(".admin-shell");
  await expect(admin).toBeVisible();
  await expect(admin).toHaveCSS("background-color", "rgb(16, 26, 37)");
  await expect(page.locator(".admin-audit-panel").first()).toHaveCSS("background-color", "rgb(29, 44, 59)");

  // Audit data can legitimately be empty. This fixture checks the existing CSS
  // table / outcome classes without inserting audit records or touching D1.
  await page.evaluate(() => {
    const panel = document.querySelector(".admin-audit-panel");
    if (!panel) throw new Error("expected audit panel");
    const fixture = document.createElement("div");
    fixture.id = "theme-audit-style-smoke";
    fixture.innerHTML = '<table class="admin-audit-table"><thead><tr><th>結果</th></tr></thead>' +
      '<tbody><tr><td><span class="admin-audit-outcome is-success">成功</span></td></tr>' +
      '<tr><td><span class="admin-audit-outcome is-failure">失敗</span></td></tr></tbody></table>' +
      '<div class="admin-audit-state is-error" role="alert"><strong>取得失敗</strong></div>';
    panel.appendChild(fixture);
  });
  const table = page.locator("#theme-audit-style-smoke .admin-audit-table");
  await expect(table.getByRole("columnheader", { name: "結果" })).toBeVisible();
  await expect(table.locator("td").first()).toHaveCSS("color", "rgb(238, 244, 248)");
  const ok = table.getByText("成功", { exact: true });
  const failure = table.getByText("失敗", { exact: true });
  await expect(ok).toHaveCSS("background-color", "rgb(32, 62, 47)");
  await expect(failure).toHaveCSS("background-color", "rgb(67, 43, 50)");
  await expect(page.locator("#theme-audit-style-smoke [role=alert]")).toContainText("取得失敗");

  const contrast = await table.locator("td").first().evaluate(el => {
    const style = getComputedStyle(el);
    const bg = getComputedStyle(el.closest(".admin-audit-panel")!);
    const parse = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color: number[]) =>
      color.map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
        .reduce((acc, value, index) => acc + value * [0.2126, 0.7152, 0.0722][index], 0);
    const a = luminance(parse(style.color)), b = luminance(parse(bg.backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});


test("#290 Slice D: A4 print policy is stable in light, dark and OS-system themes", async ({ page }, info) => {
  // Reuse the existing travel/mobile print contract against locally seeded D1.
  // This single synthetic request is not allowed against shared Preview/Remote D1.
  test.skip(info.project.name !== "desktop-chromium", "Chromium PDF only");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /おはようございます、Aoi Employeeさん/u })).toBeVisible();

  const card = page.locator("#workhub-travel-form");
  const purpose = "Theme A4 policy " + Date.now();
  await card.getByRole("combobox", { name: "行先" }).selectOption({ label: "Tokyo Office (TOKYO)" });
  await card.getByLabel("開始日", { exact: true }).fill("2026-10-20");
  await card.getByLabel("終了日", { exact: true }).fill("2026-10-21");
  await card.getByRole("textbox", { name: "目的", exact: true }).fill(purpose);
  await card.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "申請内容を印刷・PDF保存" })).toBeVisible();

  const choice = page.locator("#workhub-theme-reference")
    .getByRole("combobox", { name: "表示テーマ" });
  const surface = page.locator(".workhub-theme-scope");
  const paper = page.locator(".workhub-travel-print-sheet");
  // Unpersisted local previews avoid PATCH and preserve #288 server preferences.
  const cases: ReadonlyArray<{ mode: "light" | "dark" | "system"; os: "light" | "dark"; expected: "light" | "dark" }> = [
    { mode: "light", os: "dark", expected: "light" },
    { mode: "dark", os: "light", expected: "dark" },
    { mode: "system", os: "dark", expected: "dark" },
    { mode: "system", os: "light", expected: "light" },
  ];
  const writes: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/api/me/preferences") && request.method() === "PATCH")
      writes.push(request.url());
  });
  for (const scenario of cases) {
    await page.emulateMedia({ media: "screen", colorScheme: scenario.os });
    await choice.selectOption(scenario.mode);
    await expect(surface).toHaveAttribute("data-theme", scenario.expected);
    await page.emulateMedia({ media: "print", colorScheme: scenario.os });

    await expect(surface).toHaveCSS("min-height", "0px");
    await expect(page.locator(".workhub-home-shell")).toHaveCSS("min-height", "0px");
    await expect(page.locator(".workhub-home-header")).toBeHidden();
    await expect(paper).toBeVisible();
    await expect(paper).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(paper).toHaveCSS("color", "rgb(23, 35, 45)");
    await expect(paper.getByRole("heading", { name: "出張申請書（現在の申請内容）" })).toBeVisible();
    await expect(paper).toContainText(purpose);
    await expect(paper).toContainText("正式な承認証跡");
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/gu) ?? []).length;
    expect(pageCount, scenario.mode + "/" + scenario.os + " must print exactly one A4 page").toBe(1);
  }
  expect(writes, "Theme previews must not persist the saved preference").toEqual([]);
});


type ThemeSwitchSample = {
  label: string;
  source: "select" | "media";
  expected: "light" | "dark";
  startedAt: number | null;
  attributeDelayMs: number | null;
  settledDelayMs: number | null;
  childListRecords: number;
  addedNodes: number;
  removedNodes: number;
  sameForm: boolean | null;
  sameInput: boolean | null;
  sameScope: boolean | null;
  backgroundColor: string | null;
};

test("#290 Slice F: theme switching records response, DOM and API impact", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const surface = page.locator(".workhub-theme-scope");
  const choice = page.locator("#workhub-theme-reference")
    .getByRole("combobox", { name: "表示テーマ" });
  const form = page.locator("#workhub-travel-form");
  const purpose = form.getByRole("textbox", { name: "目的", exact: true });
  await expect(choice).toBeEnabled();
  await expect(form).toBeVisible();

  // Establish a stable local-only preview before starting the measurement window.
  await choice.selectOption("light");
  await expect(surface).toHaveAttribute("data-theme", "light");
  const draft = "theme-performance-unsaved-290";
  await purpose.fill(draft);
  // WORKHUB can keep requests active; DOM readiness is the E2E gate, not networkidle.
  await expect(purpose).toHaveValue(draft);
  const originalUrl = page.url();

  // In-page event time excludes Playwright/CDP command latency. Attribute updates
  // and two requestAnimationFrame callbacks approximate visual settling, not paint/INP.
  await page.evaluate(draftValue => {
    const scope = document.querySelector<HTMLElement>(".workhub-theme-scope");
    const formNode = document.querySelector<HTMLElement>("#workhub-travel-form");
    const select = document.querySelector<HTMLSelectElement>("#workhub-theme-choice");
    const input = Array.from(formNode?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea") ?? []).find(element => element.value === draftValue);
    if (!scope || !formNode || !select || !input) throw new Error("Theme perf targets missing");

    const probe = { active: null as ThemeSwitchSample | null };
    const begin = (source: "select" | "media") => {
      const current = probe.active;
      if (current?.source === source && current.startedAt === null) {
        current.startedAt = performance.now();
      }
    };
    // The React select/scope may be replaced during reconciliation; observe
    // native input/change at the document capture boundary, not one old node.
    const onChoice = (event: Event) => {
      if (event.target instanceof HTMLSelectElement &&
          event.target.id === "workhub-theme-choice") begin("select");
    };
    document.addEventListener("input", onChoice, { capture: true });
    document.addEventListener("change", onChoice, { capture: true });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener(
      "change", () => begin("media"));

    new MutationObserver(() => {
      const current = probe.active;
      if (!current || current.startedAt === null || current.attributeDelayMs !== null) return;
      const liveScope = document.querySelector<HTMLElement>(".workhub-theme-scope");
      if (!liveScope || liveScope.dataset.theme !== current.expected) return;
      current.attributeDelayMs = performance.now() - current.startedAt;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        current.settledDelayMs = performance.now() - current.startedAt!;
        current.sameScope = document.querySelector(".workhub-theme-scope") === scope;
        current.sameForm = document.querySelector("#workhub-travel-form") === formNode;
        current.sameInput = input.isConnected && formNode.contains(input) &&
          input.value === draftValue;
        current.backgroundColor = getComputedStyle(liveScope).backgroundColor;
      }));
    }).observe(document.body, {
      attributes: true, childList: true, subtree: true, attributeFilter: ["data-theme"],
    });
    new MutationObserver(records => {
      const current = probe.active;
      if (!current || current.startedAt === null || current.settledDelayMs !== null) return;
      current.childListRecords += records.length;
      for (const record of records) {
        current.addedNodes += record.addedNodes.length;
        current.removedNodes += record.removedNodes.length;
      }
    }).observe(formNode, { childList: true, subtree: true });

    (window as unknown as { __workhubThemeProbe: typeof probe }).__workhubThemeProbe = probe;
  }, draft);

  const origin = new URL(originalUrl).origin;
  const apiRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith("/api/")) {
      apiRequests.push(request.method() + " " + url.pathname);
    }
  });

  const samples: ThemeSwitchSample[] = [];
  const measure = async (
    label: string, source: "select" | "media", expected: "light" | "dark",
    action: () => Promise<unknown>,
  ) => {
    await page.evaluate(meta => {
      const probe = (window as unknown as {
        __workhubThemeProbe: { active: ThemeSwitchSample | null };
      }).__workhubThemeProbe;
      probe.active = {
        ...meta, startedAt: null, attributeDelayMs: null, settledDelayMs: null,
        childListRecords: 0, addedNodes: 0, removedNodes: 0,
        sameForm: null, sameInput: null, sameScope: null, backgroundColor: null,
      };
    }, { label, source, expected });
    await action();
    await expect(surface).toHaveAttribute("data-theme", expected);
    await expect.poll(async () => page.evaluate(() => {
      const probe = (window as unknown as {
        __workhubThemeProbe?: { active: ThemeSwitchSample | null };
      }).__workhubThemeProbe;
      return {
        started: typeof probe?.active?.startedAt === "number",
        attribute: typeof probe?.active?.attributeDelayMs === "number",
        settled: typeof probe?.active?.settledDelayMs === "number",
      };
    }), { timeout: 5_000, message: "Missing in-page Theme transition evidence for " + label })
      .toEqual({ started: true, attribute: true, settled: true });
    const sample = await page.evaluate(() => (window as unknown as {
      __workhubThemeProbe: { active: ThemeSwitchSample | null };
    }).__workhubThemeProbe.active);
    if (!sample) throw new Error("Missing Theme measurement");
    samples.push(sample);
    expect(sample.startedAt, label).not.toBeNull();
    if (typeof sample.attributeDelayMs !== "number" || typeof sample.settledDelayMs !== "number") {
      throw new Error("Theme transition timing unavailable: " + label);
    }
    expect(sample.attributeDelayMs, label).toBeGreaterThanOrEqual(0);
    expect(sample.settledDelayMs, label).toBeGreaterThanOrEqual(sample.attributeDelayMs);
    expect(sample.sameScope, label).toBe(true);
    expect(sample.sameForm, label).toBe(true);
    expect(sample.sameInput, label).toBe(true);
    expect(sample.childListRecords, label).toBe(0);
    expect(sample.addedNodes, label).toBe(0);
    expect(sample.removedNodes, label).toBe(0);
    expect(sample.backgroundColor, label).toBe(
      expected === "dark" ? "rgb(16, 26, 37)" : "rgb(242, 245, 246)");
    await expect(purpose).toHaveValue(draft);
  };

  await measure("light-to-dark", "select", "dark", () => choice.selectOption("dark"));
  await measure("dark-to-light", "select", "light", () => choice.selectOption("light"));
  await measure("light-to-system-os-dark", "select", "dark", () => choice.selectOption("system"));
  await expect(surface).toHaveAttribute("data-theme-mode", "system");
  await measure("system-os-dark-to-light", "media", "light",
    () => page.emulateMedia({ colorScheme: "light" }));
  await measure("system-os-light-to-dark", "media", "dark",
    () => page.emulateMedia({ colorScheme: "dark" }));

  // Request observation is limited to post-bootstrap unsaved preview/OS changes.
  await page.waitForTimeout(150);
  const evidence = {
    measurementKind: "development-browser-theme-switch-proxy",
    notReactRenderCount: true, notProductionRUM: true, notAnSLO: true,
    samples, apiRequests,
  };
  console.log("#290 THEME_SWITCH_EVIDENCE " + JSON.stringify(evidence));
  await info.attach("theme-switch-performance.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
  expect(samples).toHaveLength(5);
  expect(apiRequests, "Unsaved Theme/OS switch must not amplify API traffic").toEqual([]);
  expect(page.url()).toBe(originalUrl);
  await expect(choice).toHaveValue("system");
  await expect(purpose).toHaveValue(draft);
});
