import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, userId: "sora" | "aoi" | "ren") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(userId);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: userId === "sora" ? /Sora/u : /Aoi/u })).toBeVisible();
};

test("General Affairs publishes a company announcement; employees read but cannot publish", async ({ page }, testInfo) => {
  const title = `社内お知らせ E2E ${testInfo.project.name} ${Date.now()}`;
  const body = "全社員へ：明日の朝会は10時からです。\n会議室は第2会議室です。";

  // A session is necessary, but not sufficient: the Worker will also check
  // active WORKHUB scope membership before returning official content.
  await page.goto("/");
  expect((await page.request.get("/api/workhub/announcements")).status()).toBe(401);
  await login(page, "sora");
  const section = page.locator("#workhub-announcements");
  await expect(section.getByRole("heading", { name: "社内お知らせ" })).toBeVisible();
  await section.getByLabel("お知らせの件名").fill(title);
  await section.getByLabel("お知らせの本文").fill(body);
  await section.getByRole("button", { name: "お知らせを公開", exact: true }).click();
  await expect(page.getByText("社内お知らせを公開しました。", { exact: true })).toBeVisible();
  const item = section.locator(".workhub-announcement-item").filter({ hasText: title });
  await expect(item).toContainText(body);

  await page.context().clearCookies();
  await login(page, "aoi");
  const scopedList = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/announcements?role=corporate&scopeId=other-company", {
      credentials: "same-origin",
    });
    return { status: response.status, data: await response.json() };
  });
  expect(scopedList.status).toBe(200);
  expect(scopedList.data.items.some((entry: { title: string }) => entry.title === title)).toBe(true);
  const employeeSection = page.locator("#workhub-announcements");
  await expect(employeeSection.locator(".workhub-announcement-item").filter({ hasText: title })).toContainText(body);
  await expect(employeeSection.getByRole("button", { name: "お知らせを公開", exact: true })).toHaveCount(0);

  // Direct API calls remain forbidden even when the UI has no publisher form.
  const attempt = await page.evaluate(async () => {
    const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    const payload = await csrf.json() as { csrfToken: string };
    const response = await fetch("/api/workhub/announcements", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": payload.csrfToken },
      body: JSON.stringify({ title: "forged employee announcement", body: "must be rejected" }),
    });
    return response.status;
  });
  expect(attempt).toBe(403);
  await page.reload();
  await expect(page.locator("#workhub-announcements .workhub-announcement-item").filter({ hasText: title })).toBeVisible();
});

test("Stage4 critical official news is role-filtered server-side and has one visible Global Banner", async ({ page }, testInfo) => {
  const title = `管理職向け緊急連絡 E2E ${testInfo.project.name} ${Date.now()}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "sora");
  const area = page.locator("#workhub-announcements");
  await area.getByLabel("お知らせの件名").fill(title);
  await area.getByLabel("お知らせの本文").fill("管理職だけに共有する緊急情報（デモ）");
  await area.getByLabel("お知らせの重要度").selectOption("critical");
  await area.getByLabel("お知らせの配信対象").selectOption("manager");
  await area.getByRole("button", { name: "お知らせを公開", exact: true }).click();
  await expect(page.getByText("社内お知らせを公開しました。", { exact: true })).toBeVisible();
  // Even the publishing Corporate persona is not automatically a recipient.
  await expect(page.getByRole("alert").filter({ hasText: title })).toHaveCount(0);
  await page.context().clearCookies();
  await login(page, "aoi");
  const employeeResult = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/announcements?role=manager", { credentials: "same-origin" });
    return { status: response.status, payload: await response.json() };
  });
  expect(employeeResult.status).toBe(200);
  expect(JSON.stringify(employeeResult.payload)).not.toContain(title);
  await expect(page.getByRole("alert").filter({ hasText: title })).toHaveCount(0);
  await page.context().clearCookies();
  await login(page, "ren");
  const managerResult = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/announcements", { credentials: "same-origin" });
    return { status: response.status, payload: await response.json() };
  });
  expect(managerResult.status).toBe(200);
  const matches = managerResult.payload.items.filter((item: { title: string }) => item.title === title);
  expect(matches).toHaveLength(1);
  expect(matches[0].importance).toBe("critical");
  expect(matches[0].audienceRole).toBe("manager");
  await expect(page.getByRole("alert").filter({ hasText: title })).toBeVisible();
  await expect(area.locator(".workhub-announcement-item").filter({ hasText: title })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("Stage4 visibility windows are enforced in D1 before announcement records reach employees", async ({ page }, testInfo) => {
  const title = `未来のお知らせ E2E ${testInfo.project.name} ${Date.now()}`;
  await login(page, "sora");
  const status = await page.evaluate(async (postTitle: string) => {
    const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const now = Date.now();
    const future = new Date(now + 3600_000).toISOString();
    const end = new Date(now + 7200_000).toISOString();
    const create = await fetch("/api/workhub/announcements", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ title: postTitle, body: "掲載開始前の連絡",
        importance: "important", audienceRole: null, visibleFrom: future, visibleUntil: end }),
    });
    const list = await fetch("/api/workhub/announcements", { credentials: "same-origin" });
    const bad = await fetch("/api/workhub/announcements", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ title: "invalid", body: "invalid", audienceRole: "other-company",
        visibleFrom: end, visibleUntil: future }),
    });
    return { created: create.status, list: await list.json(), invalid: bad.status };
  }, title);
  expect(status.created).toBe(201);
  expect(status.invalid).toBe(400);
  expect(JSON.stringify(status.list)).not.toContain(title);
  await page.context().clearCookies();
  await login(page, "aoi");
  await expect(page.locator("#workhub-announcements")).not.toContainText(title);
});
