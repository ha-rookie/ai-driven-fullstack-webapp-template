import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, user: "kai" | "aoi") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: user === "kai" ? /Kai Admin/u : /Aoi Employee/u })).toBeVisible();
};

const invite = {
  id: "invite-demo-1", scopeId: "workhub-company", inviteeIdentifier: "example@example.com",
  intendedRole: "employee", issuedAt: "2026-10-14T00:00:00.000Z",
  expiresAt: "2026-10-21T00:00:00.000Z", state: "open",
};

test("#99 administrator can read bounded invitation metadata without token hashes", async ({ page }) => {
  await login(page, "kai");
  const response = page.waitForResponse(res => res.url().endsWith("/api/admin/scopes/workhub-company/invitations")
    && res.request().method() === "GET");
  await page.goto("/admin");
  const data = await response;
  expect(data.status()).toBe(200);
  expect(data.headers()["cache-control"]).toContain("no-store");
  const body = await data.json() as { scopeId: string; invitations: unknown[]; limit: number };
  expect(body.scopeId).toBe("workhub-company");
  expect(body.limit).toBe(50);
  expect(body.invitations.length).toBeLessThanOrEqual(50);
  expect(JSON.stringify(body)).not.toMatch(/redeemToken|tokenHash|token_hash/iu);
  await expect(page.getByRole("heading", { name: "Scopeへの招待" })).toBeVisible();
});

test("#99 one-time invite issuance requires confirmation and expires from browser on refresh", async ({ page }) => {
  await login(page, "kai");
  const rawToken = "test-only-one-time-invitation-token-0123456789";
  let issued = false;
  await page.route("**/api/admin/scopes/workhub-company/invitations", route => {
    if (route.request().method() === "GET") return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ scopeId: "workhub-company", limit: 50, hasMore: false,
        invitations: issued ? [invite] : [] }),
    });
    issued = true;
    return route.fulfill({ status: 201, contentType: "application/json",
      body: JSON.stringify({ invitation: invite, redeemToken: rawToken }) });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-invitations");
  const form = panel.getByRole("form", { name: "招待発行の確認" });
  const button = form.getByRole("button", { name: "招待を発行する" });
  await expect(button).toBeDisabled();
  await form.getByLabel("発行理由").fill("部門担当の権限付与申請");
  await expect(button).toBeDisabled();
  await form.getByRole("checkbox").check();
  await button.click();
  const tokenArea = panel.getByRole("region", { name: "発行直後のワンタイム招待" });
  await expect(tokenArea).toContainText(rawToken);
  await expect(panel.locator("tr").filter({ hasText: "invite-demo-1" })).toContainText("employee");
  await panel.getByRole("button", { name: "招待一覧を再取得" }).click();
  await expect(tokenArea).toHaveCount(0);
  await expect(panel.getByRole("table")).not.toContainText(rawToken);
});

test("#99 invitation revoke confirms target and re-reads list without shared D1 mutation", async ({ page }) => {
  await login(page, "kai");
  let revoked = false;
  await page.route("**/api/admin/scopes/workhub-company/invitations", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ scopeId: "workhub-company", limit: 50, hasMore: false,
      invitations: [{ ...invite, state: revoked ? "revoked" : "open" }] }),
  }));
  await page.route("**/api/admin/scopes/workhub-company/invitations/invite-demo-1/revoke", route => {
    revoked = true;
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ invitation: { ...invite, state: "revoked" } }) });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-invitations");
  const form = panel.getByRole("form", { name: "招待取消の確認" });
  await form.getByLabel("対象の招待").selectOption(invite.id);
  const button = form.getByRole("button", { name: "この招待を取り消す" });
  await expect(button).toBeDisabled();
  await form.getByLabel("取消理由").fill("予定変更");
  await form.getByRole("checkbox").check();
  await button.click();
  await expect(panel.locator("tr").filter({ hasText: invite.id })).toContainText("revoked");
  await expect(panel.getByRole("status").filter({ hasText: "取り消し" })).toBeVisible();
});

test("#99 invitation API rejects nonadmins, CSRF missing and privileged role issuance", async ({ page }) => {
  await login(page, "kai");
  const code = await page.evaluate(async () => {
    const path = "/api/admin/scopes/workhub-company/invitations";
    const noCsrf = await fetch(path, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ intendedRole: "employee", reason: "CSRF確認", confirmed: true }) });
    const csrf = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const invalidRole = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ intendedRole: "system_admin", reason: "Role権限チェック", confirmed: true }) });
    const otherScope = await fetch("/api/admin/scopes/other-company/invitations");
    return [noCsrf.status, invalidRole.status, otherScope.status];
  });
  expect(code).toEqual([403, 400, 403]);
});

test("#99 ordinary employee cannot enumerate or issue invitations", async ({ page }) => {
  await login(page, "aoi");
  const result = await page.evaluate(async () => {
    const url = "/api/admin/scopes/workhub-company/invitations";
    const list = await fetch(url);
    const csrf = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const issue = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ intendedRole: "employee", reason: "認可不可", confirmed: true }) });
    return [list.status, issue.status];
  });
  expect(result).toEqual([403, 403]);
});
