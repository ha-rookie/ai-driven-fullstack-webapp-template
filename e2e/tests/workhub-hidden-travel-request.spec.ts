import { expect, test } from "@playwright/test";

// Runs against the local seeded D1 browser fixture. No Preview/Production
// mutations or remote testing; the unauthorized phase is GET-only.
test("another employee cannot distinguish a hidden TravelRequest from a missing ID", async ({ page }, info) => {
  const purpose = `Hidden TravelRequest E2E ${info.project.name}`;
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Aoi Employeeさん/u })).toBeVisible();

  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("開始日").fill("2026-10-20");
  await page.getByLabel("終了日").fill("2026-10-21");
  await page.getByLabel("目的", { exact: true }).fill(purpose);
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();

  const ownedId = await page.evaluate(async (label) => {
    const response = await fetch("/api/workhub/travel-requests", { credentials: "same-origin" });
    if (!response.ok) throw new Error("owner list failed");
    const payload = await response.json() as { items: Array<{ id: string; purpose: string }> };
    return payload.items.find(row => row.purpose === label)?.id ?? null;
  }, purpose);
  expect(ownedId).toBeTruthy();

  // Owner access works before switching to another authenticated principal.
  const ownerDetail = await page.evaluate(async id => {
    const response = await fetch(`/api/workhub/travel-requests/${encodeURIComponent(id!)}`, { credentials: "same-origin" });
    const body = await response.json() as { request?: { purpose?: string } };
    return { status: response.status, purpose: body.request?.purpose };
  }, ownedId);
  expect(ownerDetail).toEqual({ status: 200, purpose });

  await page.context().clearCookies();
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("ren");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Ren Managerさん/u })).toBeVisible();

  const reads = await page.evaluate(async id => {
    const get = async (identifier: string) => {
      const response = await fetch(`/api/workhub/travel-requests/${encodeURIComponent(identifier)}`, {
        credentials: "same-origin",
      });
      return { status: response.status, body: await response.json() };
    };
    return {
      hidden: await get(id!),
      missing: await get("nonexistent-hidden-travel-request-control"),
    };
  }, ownedId);
  expect(reads.hidden.status).toBe(404);
  expect(reads.hidden).toEqual(reads.missing);
  expect(JSON.stringify(reads.hidden)).not.toContain(purpose);
});
