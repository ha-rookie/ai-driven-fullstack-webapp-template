import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, user: "kai" | "aoi") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: user === "kai" ? /Kai Admin/u : /Aoi Employee/u })).toBeVisible();
};

test("#99 admin sees real scope members and looks up sessions without raw tokens", async ({ page }) => {
  await login(page, "kai");
  const membersRequest = page.waitForResponse(response =>
    response.url().includes("/api/admin/scopes/workhub-company/memberships")
    && response.request().method() === "GET");
  await page.goto("/admin");
  const members = await membersRequest;
  expect(members.status()).toBe(200);
  expect(members.headers()["cache-control"]).toContain("no-store");
  const payload = await members.json() as { scopeId: string; members: { userId: string; role: string; status: string }[]; limit: number; hasMore: boolean };
  expect(payload.scopeId).toBe("workhub-company");
  expect(payload.limit).toBe(50);
  expect(payload.members.length).toBeGreaterThan(0);
  expect(payload.members.length).toBeLessThanOrEqual(50);
  expect(JSON.stringify(payload)).not.toMatch(/tokenHash|sessionToken|password|providerSubject|email/i);

  const panel = page.locator("#admin-users-and-access");
  await expect(panel.getByRole("heading", { name: "ユーザー・権限管理" })).toBeVisible();
  await expect(panel.getByRole("table")).toBeVisible();
  await expect(page.locator("#admin-users-and-access").getByText("このScopeの所属ユーザーは見つかりませんでした。")).toHaveCount(0);
  const sessionRequest = page.waitForResponse(response =>
    response.url().includes("/api/admin/scopes/workhub-company/users/")
    && response.url().endsWith("/sessions") && response.request().method() === "GET");
  await panel.getByRole("button", { name: "有効セッションを確認" }).first().click();
  const sessions = await sessionRequest;
  expect(sessions.status()).toBe(200);
  const result = await sessions.json() as { sessions: { sessionId: string; lastSeenAt: string }[] };
  expect(Array.isArray(result.sessions)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/tokenHash|sessionToken|password/i);
  await expect(panel.getByRole("heading", { name: /有効セッション/u })).toBeVisible();
  await expect(panel.getByText("認証トークンやハッシュは取得・表示しません。", { exact: false })).toBeVisible();
});

test("#99 normal employee cannot mount Users & Access or enumerate scope members", async ({ page }) => {
  await login(page, "aoi");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "この領域を表示する権限がありません" })).toBeVisible();
  await expect(page.locator("#admin-users-and-access")).toHaveCount(0);
  const status = await page.evaluate(async () => (await fetch("/api/admin/scopes/workhub-company/memberships")).status);
  expect(status).toBe(403);
});

test("#99 inaccessible directory fails visibly without fabricating empty/healthy state", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/scopes/workhub-company/memberships", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "administration_unavailable" } }),
  }));
  await page.goto("/admin");
  const panel = page.locator("#admin-users-and-access");
  await expect(panel.getByRole("alert")).toContainText("所属ユーザーを取得できませんでした");
  await expect(panel.getByText("このScopeの所属ユーザーは見つかりませんでした。")).toHaveCount(0);
  await page.unroute("**/api/admin/scopes/workhub-company/memberships");
  await panel.getByRole("button", { name: "所属ユーザーを再取得" }).click();
  await expect(panel.getByRole("table")).toBeVisible();
});


test("#99 status mutation is gated by confirmation and shows conflict before any success", async ({ page }) => {
  await login(page, "kai");
  await page.goto("/admin");
  const panel = page.locator("#admin-users-and-access");
  const row = panel.locator("tr").filter({ hasText: "workhub-demo-aoi" });
  await expect(row).toBeVisible();
  await expect(panel.locator("tr").filter({ hasText: "workhub-demo-kai" })).toContainText("管理者の状態変更不可");

  let posts = 0;
  let changed = false;
  await page.route("**/api/admin/scopes/workhub-company/memberships", async route => {
    if (!changed) return route.continue();
    const response = await route.fetch();
    const data = await response.json() as { members: { userId: string; status: string }[] };
    return route.fulfill({ response, json: {
      ...data, members: data.members.map(member => member.userId === "workhub-demo-aoi" ? { ...member, status: "disabled" } : member),
    } });
  });
  await page.route("**/api/admin/scopes/workhub-company/users/workhub-demo-aoi/disable", route => {
    posts++;
    if (posts === 1) return route.fulfill({ status: 409, contentType: "application/json", body: '{"error":{"code":"stale_user_status"}}' });
    changed = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"result":{"nextStatus":"disabled"}}' });
  });

  await row.getByRole("button", { name: "無効化を確認" }).click();
  const form = panel.getByRole("form", { name: "ユーザー状態変更の確認" });
  await expect(form.getByRole("button", { name: "このユーザーを無効化" })).toBeDisabled();
  await form.getByLabel("操作理由").fill("担当者の異動に伴う利用停止");
  await expect(form.getByRole("button", { name: "このユーザーを無効化" })).toBeDisabled();
  await form.getByRole("checkbox", { name: /対象・状態・影響範囲を確認/u }).check();
  await form.getByRole("button", { name: "このユーザーを無効化" }).click();
  await expect(panel.getByRole("alert")).toContainText("対象の状態が変更されています");
  expect(posts).toBe(1);
  await row.getByRole("button", { name: "無効化を確認" }).click();
  const retryForm = panel.getByRole("form", { name: "ユーザー状態変更の確認" });
  await retryForm.getByLabel("操作理由").fill("管理者承認済みの利用停止");
  await retryForm.getByRole("checkbox", { name: /対象・状態・影響範囲を確認/u }).check();
  await retryForm.getByRole("button", { name: "このユーザーを無効化" }).click();
  await expect(panel.getByRole("status")).toContainText("無効化が完了しました");
  await expect(row).toContainText("無効");
  await expect(row.getByRole("button", { name: "再有効化を確認" })).toBeVisible();
  expect(posts).toBe(2);
});

test("#99 lifecycle API rejects absent CSRF, privilege self-change and ordinary employees", async ({ page }) => {
  await login(page, "kai");
  const target = "/api/admin/scopes/workhub-company/users/workhub-demo-aoi/disable";
  const noProofStatus = await page.evaluate(async url => (await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "実行されない確認", confirmed: true, expectedStatus: "active" }),
  })).status, target);
  expect(noProofStatus).toBe(403);

  const selfStatus = await page.evaluate(async () => {
    const csrf = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    return (await fetch("/api/admin/scopes/workhub-company/users/workhub-demo-kai/disable", {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ reason: "拒否される特権ユーザー操作", confirmed: true, expectedStatus: "active" }),
    })).status;
  });
  expect(selfStatus).toBe(403);

  await page.goto("/");
  await page.getByRole("button", { name: /ログアウト/u }).first().click();
  await login(page, "aoi");
  const nonAdminStatus = await page.evaluate(async url => {
    const csrf = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    return (await fetch(url, {
      method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ reason: "権限なし", confirmed: true, expectedStatus: "active" }),
    })).status;
  }, target);
  expect(nonAdminStatus).toBe(403);
});
