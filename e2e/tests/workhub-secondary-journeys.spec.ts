import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, user: "aoi" | "sora" | "ren") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(user, "iu") })).toBeVisible();
};
const changeIdentity = async (page: Page, user: "aoi" | "sora" | "ren") => {
  await page.context().clearCookies();
  await login(page, user);
};

test("moving simulation persists partial step completion across reload", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page, "aoi");
  const section = page.locator("#workhub-secondary-journeys");
  await expect(section.getByRole("heading", { name: "手続きの進捗デモ" })).toBeVisible();
  await section.getByRole("button", { name: "引っ越し手続きをデモ開始" }).click();
  const moving = section.locator(".workhub-secondary-item").filter({ hasText: "引っ越した" }).last();
  await expect(moving).toContainText("0/3ステップ");
  await moving.getByRole("button", { name: "住所変更の確認（デモ）をデモ完了する" }).click();
  await expect(moving).toContainText("1/3ステップ");
  await expect(moving).toBeFocused();
  const geometry = await moving.evaluate(node => ({
    scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  await expect(moving).toContainText("住所変更の確認（デモ）");
  await page.reload();
  await expect(section.locator(".workhub-secondary-item").filter({ hasText: "引っ越した" }).first())
    .toContainText("1/3ステップ");
});

test("PC exchange mock transfers assigned work to Corporate and back without admin access", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, "aoi");
  let section = page.locator("#workhub-secondary-journeys");
  // Capture the newly created request key. Other tests may have left PC
  // demo work items in the local DB; the first card is not necessarily ours.
  let requestKey = "";
  page.on("request", request => {
    if (request.url().endsWith("/api/workhub/secondary-journeys") && request.method() === "POST") {
      const data = request.postDataJSON() as { intent?: string; key?: string };
      if (data.intent === "pc-replacement") requestKey = data.key ?? "";
    }
  });
  await section.getByRole("button", { name: "PC交換をデモ依頼" }).click();
  await expect.poll(() => requestKey).not.toBe("");
  let journeyId = "";
  await expect.poll(async () => {
    journeyId = await page.evaluate(async key => {
      const response = await fetch("/api/workhub/secondary-journeys", { credentials: "same-origin" });
      if (!response.ok) return "";
      const data = await response.json() as { items: Array<{ id: string; submissionKey: string }> };
      return data.items.find(item => item.submissionKey.endsWith(key))?.id ?? "";
    }, requestKey);
    return journeyId;
  }).not.toBe("");
  let pc = section.locator(`[data-journey-id="${journeyId}"]`);
  await expect(pc).toContainText("0/4ステップ");
  await pc.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(pc).toContainText("1/4ステップ");
  await expect(pc.getByText("現在の担当者による確認待ち")).toBeVisible();

  await changeIdentity(page, "ren");
  await expect(page.locator("#workhub-secondary-journeys")).toHaveCount(0);
  const deniedStatus = await page.evaluate(async () => (await fetch("/api/workhub/secondary-journeys", { credentials: "same-origin" })).status);
  expect(deniedStatus).toBe(403);

  await changeIdentity(page, "sora");
  section = page.locator("#workhub-secondary-journeys");
  pc = section.locator(`[data-journey-id="${journeyId}"]`);
  await expect(pc).toContainText("1/4ステップ");
  await pc.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(pc).toContainText("2/4ステップ");
  await pc.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(pc).toHaveCount(0); // Corporate no longer assigned; employee receives final task.
  await expect(section).toBeFocused(); // The removed action does not strand keyboard focus.

  await changeIdentity(page, "aoi");
  section = page.locator("#workhub-secondary-journeys");
  pc = section.locator(`[data-journey-id="${journeyId}"]`);
  await expect(pc).toContainText("3/4ステップ");
  await pc.getByRole("button", { name: "現在のデモステップを完了する" }).click();
  await expect(pc).toContainText("デモ完了");
  await expect(pc).toContainText("4/4ステップ");
  await expect(pc).toBeFocused();
});

test("lost secondary start response can be explicitly retried with the same key, without a duplicate", async ({ page }) => {
  await login(page, "aoi");
  let attempts = 0;
  const keys: string[] = [];
  let committedId: string | null = null;
  await page.route("**/api/workhub/secondary-journeys", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    attempts++;
    const body = route.request().postDataJSON() as { intent: string; key: string };
    keys.push(body.key);
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    const result = await committed.json() as { item: { id: string } };
    committedId ??= result.item.id;
    expect(result.item.id).toBe(committedId);
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    } else {
      await route.fulfill({ response: committed });
    }
  });

  const section = page.locator("#workhub-secondary-journeys");
  await section.getByRole("button", { name: "引っ越し手続きをデモ開始" }).click();
  await expect(section.getByRole("alert")).toContainText("再送信せず");
  await expect(section.getByRole("button", { name: "引っ越し手続きをデモ開始" })).toBeDisabled();
  await section.getByRole("button", { name: "同じ依頼を安全に再確認・再試行" }).click();

  const current = section.locator(".workhub-secondary-item").filter({ hasText: "引っ越した" });
  await expect(current.filter({ hasText: "0/3ステップ" }).first()).toBeVisible();
  expect(attempts).toBe(2);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await page.unroute("**/api/workhub/secondary-journeys");

  const listed = await page.evaluate(async () => {
    const response = await fetch("/api/workhub/secondary-journeys", { credentials: "same-origin" });
    if (!response.ok) throw new Error("list unavailable");
    return response.json() as Promise<{ items: Array<{ id: string }> }>;
  });
  expect(listed.items.filter(item => item.id === committedId)).toHaveLength(1);

  // Reusing an existing owner key for a different journey is rejected,
  // never silently reassigned to another workflow definition.
  const crossIntentStatus = await page.evaluate(async (key) => {
    const token = await fetch("/api/auth/csrf", { credentials: "same-origin" });
    const { csrfToken } = await token.json() as { csrfToken: string };
    const response = await fetch("/api/workhub/secondary-journeys", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ key, intent: "pc-replacement" }),
    });
    return response.status;
  }, keys[0]);
  expect(crossIntentStatus).toBe(409);
});

test("moving mock adapters keep independently completed steps after one adapter fails", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "aoi");
  const section = page.locator("#workhub-secondary-journeys");
  let journeyId = "";
  page.on("request", request => {
    if (request.url().endsWith("/api/workhub/secondary-journeys") && request.method() === "POST") {
      journeyId = (request.postDataJSON() as { key: string }).key;
    }
  });
  await section.getByRole("button", { name: "引っ越し手続きをデモ開始" }).click();
  await expect.poll(() => journeyId).not.toBe("");
  const moving = section.locator(`[data-journey-id="${journeyId}"]`);
  await expect(moving).toContainText("0/3ステップ");
  const complete = (label: string) =>
    moving.getByRole("button", { name: `${label}をデモ完了する` });

  // The address adapter fails to respond; it must not block the two other
  // independently stored mock workflow resources.
  await page.route("**/api/workhub/secondary-journeys/*/advance", async route => {
    const body = route.request().postDataJSON() as { stepKey?: string };
    if (body.stepKey === "address") {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });
  await complete("住所変更の確認（デモ）").click();
  await expect(section.getByRole("alert")).toContainText("処理結果を確認できません");
  await complete("通勤経路の確認（デモ）").click();
  await expect(moving).toContainText("1/3ステップ");
  await complete("緊急連絡先の確認（デモ）").click();
  await expect(moving).toContainText("2/3ステップ");
  await expect(complete("住所変更の確認（デモ）")).toBeVisible();
  await page.reload();
  const restored = page.locator(`#workhub-secondary-journeys [data-journey-id="${journeyId}"]`);
  await expect(restored).toContainText("2/3ステップ");
  await expect(restored.getByRole("button", { name: "住所変更の確認（デモ）をデモ完了する" })).toBeVisible();

  await page.unroute("**/api/workhub/secondary-journeys/*/advance");
  await restored.getByRole("button", { name: "住所変更の確認（デモ）をデモ完了する" }).click();
  await expect(restored).toContainText("3/3ステップ");
  await expect(restored).toContainText("デモ完了");
});
