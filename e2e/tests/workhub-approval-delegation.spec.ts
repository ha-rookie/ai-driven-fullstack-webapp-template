import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, persona: "aoi" | "ren" | "mei" | "kai") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(persona);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const name = { aoi: "Aoi Employee", ren: "Ren Manager", mei: "Mei Accounting", kai: "Kai Admin" }[persona];
  await expect(page.getByRole("heading", { name: new RegExp(name, "u") })).toBeVisible();
};
const change = async (page: Page, persona: "aoi" | "ren" | "mei" | "kai") => {
  await page.context().clearCookies();
  await login(page, persona);
};
const submitTravel = async (page: Page, purpose: string) => {
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("開始日").fill("2026-10-20");
  await page.getByLabel("終了日").fill("2026-10-21");
  await page.getByLabel("目的", { exact: true }).fill(purpose);
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();
};

test("explicit manager delegation shows travel work only within grant, and revocation restores deny", async ({ page }, info) => {
  // This scenario mutates one named Reference grant; run only once per CI run.
  test.skip(info.project.name !== "desktop-chromium", "single shared grant is tested at 390px in desktop project");
  test.setTimeout(100_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const first = "出張代理承認 " + info.project.name + " " + Date.now();
  const afterRevoke = first + " 取消後";
  await login(page, "aoi");
  await submitTravel(page, first);

  await change(page, "ren");
  // A previous local run must not implicitly authorize this test.
  const enabled = page.getByRole("button", { name: "Meiへ24時間委任する" });
  const revoked = page.getByRole("button", { name: "代理承認を取り消す" });
  await expect(enabled.or(revoked)).toBeVisible();
  if (await revoked.isVisible()) {
    await revoked.click();
    await expect(enabled).toBeVisible();
  }

  await change(page, "mei");
  await expect(page.locator("#workhub-my-work").getByText(first, { exact: true })).toHaveCount(0);
  // Even an Accounting persona cannot create its own manager delegation.
  const deniedGrant = await page.evaluate(async () => {
    const csrf = await fetch("/api/auth/csrf").then(r => r.json()) as { csrfToken: string };
    const response = await fetch("/api/workhub/approval-delegation", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf.csrfToken },
      body: JSON.stringify({ enabled: true }),
    });
    return response.status;
  });
  expect(deniedGrant).toBe(403);

  await change(page, "ren");
  await enabled.click();
  await expect(page.getByRole("status").filter({ hasText: "Meiへ委任中" })).toBeVisible();
  await change(page, "mei");
  const task = page.locator("#workhub-my-work .workhub-task-item").filter({ hasText: first });
  await expect(task).toContainText("Renの代理として操作・記録します");
  const record = await page.evaluate(async purpose => {
    const response = await fetch("/api/workhub/my-work", { credentials: "same-origin" });
    if (!response.ok) throw new Error("MY WORK read failed");
    const payload = await response.json() as { items: Array<{
      workItem: { assigneePrincipal: string };
      request: { purpose: string };
    }> };
    return payload.items.find(item => item.request.purpose === purpose)?.workItem.assigneePrincipal ?? "";
  }, first);
  expect(record).toBe("workhub-demo-ren"); // Delegation never forges assignee identity.
  await task.getByRole("button", { name: "承認する" }).click();
  await expect(page.getByText("承認しました。", { exact: true })).toBeVisible();
  await expect(task).toHaveCount(0);

  await change(page, "ren");
  await revoked.click();
  await expect(enabled).toBeVisible();

  await change(page, "aoi");
  await submitTravel(page, afterRevoke);
  await change(page, "mei");
  await expect(page.locator("#workhub-my-work").getByText(afterRevoke, { exact: true })).toHaveCount(0);
  await change(page, "kai");
  const deniedAdmin = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/approval-delegation", { credentials: "same-origin" });
    return response.status;
  });
  expect(deniedAdmin).toBe(403);
});
