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


test("#290 Slice F: theme transitions record DOM response, business remounts and API budget", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "デモユーザを選ぶ" }).click();
  await page.getByRole("dialog", { name: "デモユーザを選ぶ" })
    .getByRole("button", { name: /Aoi Employee/u }).click();
  await page.getByRole("button", { name: "ログイン", exact: true }).click();

  const panel = page.locator("#workhub-theme-reference");
  const choice = panel.getByRole("combobox", { name: "表示テーマ" });
  const surface = page.locator(".workhub-theme-scope");
  const purpose = page.getByRole("textbox", { name: "目的", exact: true });
  await expect(choice).toBeEnabled();
  await choice.selectOption("light"); // Establish a deterministic unsaved starting point.
  await expect(surface).toHaveAttribute("data-theme", "light");
  await purpose.fill("theme-performance-draft-290");

  // Arm after authentication and initial preference/business GETs have settled.
  // Observe the existing DOM; do not add React instrumentation or application APIs.
  await page.evaluate(() => {
    type Sample = {
      event: "select-change" | "os-emulation-armed";
      timingBasis: "browser-select-change" | "before-playwright-emulateMedia";
      attributeMs: number | null;
      twoRafMs: number | null;
      businessChildListMutations: number;
      businessAddedElements: number;
      businessRemovedElements: number;
      businessFormReplaced: boolean;
      purposeReplaced: boolean;
    };
    type Probe = {
      samples: Sample[];
      pending: { startedAt: number; sample: Sample } | null;
      originalForm: Element;
      originalPurpose: Element;
      armOsTransition: () => void;
    };
    const scope = document.querySelector(".workhub-theme-scope");
    const form = document.querySelector("#workhub-travel-form");
    const input = document.querySelector("#workhub-travel-purpose");
    const select = document.querySelector("#workhub-theme-choice");
    if (!scope || !form || !input || !select) throw new Error("Theme performance probe targets missing");
    const global = window as typeof window & { __themePerfProbe?: Probe };
    const probe: Probe = {
      samples: [], pending: null, originalForm: form, originalPurpose: input,
      armOsTransition: () => start("os-emulation-armed"),
    };
    global.__themePerfProbe = probe;
    const start = (event: Sample["event"]) => {
      if (probe.pending) throw new Error("Overlapping theme performance samples");
      const sample: Sample = {
        event,
        timingBasis: event === "select-change"
          ? "browser-select-change" : "before-playwright-emulateMedia",
        attributeMs: null, twoRafMs: null,
        businessChildListMutations: 0, businessAddedElements: 0,
        businessRemovedElements: 0, businessFormReplaced: false, purposeReplaced: false,
      };
      probe.pending = { startedAt: performance.now(), sample };
      probe.samples.push(sample);
    };
    select.addEventListener("change", () => start("select-change"), { capture: true });
    // Different MediaQueryList instances may dispatch separately. In an OS emulation,
    // React can commit data-theme before this test's own MQL change event fires.
    // Arm explicitly before Playwright's emulation so the DOM mutation is never lost.
    // Unlike select-change timing, OS timing includes Playwright command dispatch.
    new MutationObserver(records => {
      const pending = probe.pending;
      if (!pending) return;
      if (pending.sample.attributeMs !== null) return;
      if (!records.some(record => record.attributeName === "data-theme")) return;
      pending.sample.attributeMs = performance.now() - pending.startedAt;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        pending.sample.twoRafMs = performance.now() - pending.startedAt;
        pending.sample.businessFormReplaced =
          document.querySelector("#workhub-travel-form") !== probe.originalForm;
        pending.sample.purposeReplaced = !probe.originalPurpose.isConnected;
        probe.pending = null;
      }));
    }).observe(scope, { attributes: true, attributeFilter: ["data-theme"] });
    new MutationObserver(records => {
      if (!probe.pending) return;
      for (const record of records) {
        if (record.type !== "childList") continue;
        probe.pending.sample.businessChildListMutations++;
        probe.pending.sample.businessAddedElements += [...record.addedNodes]
          .filter(node => node.nodeType === Node.ELEMENT_NODE).length;
        probe.pending.sample.businessRemovedElements += [...record.removedNodes]
          .filter(node => node.nodeType === Node.ELEMENT_NODE).length;
      }
    }).observe(form, { childList: true, subtree: true });
  });

  const apiRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin === new URL(page.url()).origin && url.pathname.startsWith("/api/")) {
      apiRequests.push(request.method() + " " + url.pathname);
    }
  });

  const scenarios = [
    { label: "light-to-dark", kind: "select", mode: "dark", expected: "dark" },
    { label: "dark-to-light", kind: "select", mode: "light", expected: "light" },
    { label: "light-to-system-os-dark", kind: "select", mode: "system", expected: "dark" },
    { label: "system-os-dark-to-light", kind: "os", os: "light", expected: "light" },
    { label: "system-os-light-to-dark", kind: "os", os: "dark", expected: "dark" },
  ] as const;
  const evidence: Array<Record<string, unknown>> = [];
  for (const scenario of scenarios) {
    if (scenario.label === "light-to-system-os-dark") {
      await page.emulateMedia({ colorScheme: "dark" });
      // In explicit light mode, an OS change must not alter data-theme.
      await expect(surface).toHaveAttribute("data-theme", "light");
      // No active measurement: the explicit light preference must ignore OS changes.
    }
    const before = await page.evaluate(() =>
      (window as typeof window & { __themePerfProbe?: { samples: unknown[] } })
        .__themePerfProbe?.samples.length ?? -1);
    const requestStart = apiRequests.length;
    if (scenario.kind === "select") {
      await choice.selectOption(scenario.mode);
    } else {
      await page.evaluate(() => {
        const probe = (window as typeof window & {
          __themePerfProbe?: { armOsTransition: () => void };
        }).__themePerfProbe;
        if (!probe) throw new Error("Theme probe missing before OS emulation");
        probe.armOsTransition();
      });
      await page.emulateMedia({ colorScheme: scenario.os });
    }
    await expect(surface).toHaveAttribute("data-theme", scenario.expected);
    await page.waitForFunction(index => {
      const probe = (window as typeof window & {
        __themePerfProbe?: { samples: Array<{ twoRafMs: number | null }> };
      }).__themePerfProbe;
      return probe?.samples[index]?.twoRafMs !== null &&
        typeof probe?.samples[index]?.twoRafMs === "number";
    }, before, { timeout: 8000 });
    await expect(purpose).toHaveValue("theme-performance-draft-290");
    const sample = await page.evaluate(index => {
      const probe = (window as typeof window & {
        __themePerfProbe?: { samples: Array<{
          event: string; timingBasis: string;
          attributeMs: number | null; twoRafMs: number | null;
          businessChildListMutations: number; businessAddedElements: number;
          businessRemovedElements: number; businessFormReplaced: boolean;
          purposeReplaced: boolean;
        }> };
      }).__themePerfProbe;
      return probe?.samples[index] ?? null;
    }, before);
    expect(sample, scenario.label + ": missing performance sample").not.toBeNull();
    expect(sample!.event, scenario.label + ": wrong event origin")
      .toBe(scenario.kind === "select" ? "select-change" : "os-emulation-armed");
    await expect(surface).toHaveAttribute("data-theme-mode",
      scenario.kind === "os" ? "system" : scenario.mode);
    expect(sample!.attributeMs, scenario.label + ": missing attribute timing").toBeGreaterThanOrEqual(0);
    expect(sample!.twoRafMs, scenario.label + ": missing two-rAF timing").toBeGreaterThanOrEqual(0);
    expect(sample!.businessFormReplaced, scenario.label + ": form remounted").toBe(false);
    expect(sample!.purposeReplaced, scenario.label + ": purpose input remounted").toBe(false);
    expect(sample!.businessRemovedElements, scenario.label + ": business nodes removed").toBe(0);
    expect(sample!.businessAddedElements, scenario.label + ": business nodes added").toBe(0);
    const requests = apiRequests.slice(requestStart);
    expect(requests, scenario.label + ": theme preview/OS switch must not fetch APIs").toEqual([]);
    evidence.push({ transition: scenario.label, ...sample, requests });
  }
  await testInfo.attach("theme-switch-performance.json", {
    body: JSON.stringify({
      environment: "local Playwright dev server; not a production SLO or React render count",
      timingCaveat: "OS-emulation-armed latency includes Playwright command dispatch; select-change starts in browser",
      samples: evidence,
    }, null, 2),
    contentType: "application/json",
  });
  console.log("#290 Theme switch timing and DOM/API evidence:", JSON.stringify(evidence));
});
