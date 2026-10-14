import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * #350 G local integration only: browser -> session/authorization -> Worker ->
 * actual locally persisted D1 generated_artifacts row. Never use route.fulfill()
 * to invent a successful workflow or report status, and never touch remote D1.
 */
const login = async (page: Page, userId: "aoi" | "ren") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(userId);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", {
    name: userId === "aoi" ? /Aoi Employeeさん/u : /Ren Managerさん/u,
  })).toBeVisible();
};

const switchUser = async (page: Page, userId: "aoi" | "ren") => {
  await page.context().clearCookies();
  await login(page, userId);
};

const sqlQuote = (value: string) => "'" + value.replaceAll("'", "''") + "'";

const insertLocalFailedReport = (requestId: string) => {
  const id = "report-failed-e2e-" + randomUUID();
  const privateObject = "private-report-e2e-" + randomUUID();
  const privateFailure = "PROVIDER_PRIVATE_FAILURE_E2E_" + randomUUID().replaceAll("-", "");
  const sql = `INSERT INTO generated_artifacts (
    id, environment, report_key, definition_version, template_key, template_version,
    resource_type, resource_id, source_snapshot_id, generation_intent, output_type,
    object_identifier, content_type, byte_length, requested_at, generated_at,
    generated_by, status, version, failure_code, expires_at
  ) VALUES (
    ${sqlQuote(id)}, 'local', 'workhub.travel-approval', '1',
    'workhub.travel-approval.pdf', '1', 'workhub.travel_request',
    ${sqlQuote(requestId)}, ${sqlQuote("snapshot-" + id)}, 'original', 'pdf',
    ${sqlQuote(privateObject)}, NULL, NULL, ${sqlQuote(new Date().toISOString())},
    NULL, 'workhub-demo-aoi', 'failed', 1, ${sqlQuote(privateFailure)}, NULL
  );`;

  // Keep the test pinned to the repository's local seeded D1 binding.
  // Both preview/production and --remote are intentionally absent.
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
    "--no-install", "wrangler", "d1", "execute", "DB", "--local", "--command", sql,
  ], { cwd: process.cwd(), stdio: "pipe", timeout: 45_000 });
  return { privateObject, privateFailure };
};

test("#350 real persisted failed report keeps approved TravelRequest authoritative and private", async ({ page }, info) => {
  test.setTimeout(105_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const purpose = "帳票D1失敗 IT " + info.project.name + " " + randomUUID().slice(0, 8);

  await login(page, "aoi");
  await page.getByLabel("行先").selectOption({ label: "Tokyo Office (TOKYO)" });
  await page.getByLabel("開始日").fill("2026-10-20");
  await page.getByLabel("終了日").fill("2026-10-21");
  await page.getByLabel("目的", { exact: true }).fill(purpose);
  await page.getByRole("button", { name: "出張申請を提出" }).click();
  await expect(page.getByText("出張申請を提出しました。", { exact: true })).toBeVisible();

  const ownedId = await page.evaluate(async label => {
    const response = await fetch("/api/workhub/travel-requests", { credentials: "same-origin" });
    if (!response.ok) throw new Error("owned list request failed");
    const data = await response.json() as { items: Array<{ id: string; purpose: string }> };
    return data.items.find(item => item.purpose === label)?.id ?? null;
  }, purpose);
  expect(ownedId).toBeTruthy();

  await switchUser(page, "ren");
  const task = page.getByText(purpose, { exact: true }).locator("..");
  await expect(task).toBeVisible();
  await task.getByRole("button", { name: "承認する" }).click();
  await expect(page.getByText("承認しました。", { exact: true })).toBeVisible();

  await switchUser(page, "aoi");
  // Real Worker/D1 authoritative completed workflow, before any fixture insert.
  const before = await page.evaluate(async id => {
    const response = await fetch("/api/workhub/travel-requests/" + encodeURIComponent(id!), { credentials: "same-origin" });
    return { status: response.status, body: await response.json() as {
      request?: { id: string };
      workflow?: { state: string };
      reportStatus?: { state: string };
    } };
  }, ownedId);
  expect(before.status).toBe(200);
  expect(before.body.request?.id).toBe(ownedId);
  expect(before.body.workflow?.state).toBe("completed");
  expect(before.body.reportStatus?.state).toBe("not_generated");

  const privateValues = insertLocalFailedReport(ownedId!);
  let reads = 0;
  let businessMutations = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/workhub\/travel-requests\/[^/]+$/u.test(path) && request.method() === "GET") reads++;
    if (path.startsWith("/api/workhub/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) businessMutations++;
  });

  const card = page.locator(".workhub-my-requests").getByRole("button", { name: new RegExp(purpose, "u") });
  await card.click();
  const detail = page.locator("#workhub-request-detail");
  await expect(detail).toContainText("Workflow: completed");
  const report = detail.getByRole("region", { name: "帳票生成状況" });
  await expect(report.getByRole("alert")).toContainText("帳票生成に失敗しました");
  await expect(report).toContainText("承認は完了しています");
  await expect(report).not.toContainText("承認に失敗しました");
  await expect(detail).not.toContainText(privateValues.privateFailure);
  await expect(detail).not.toContainText(privateValues.privateObject);

  const actual = await page.evaluate(async id => {
    const response = await fetch("/api/workhub/travel-requests/" + encodeURIComponent(id!), { credentials: "same-origin" });
    return { status: response.status, raw: await response.text() };
  }, ownedId);
  expect(actual.status).toBe(200);
  const payload = JSON.parse(actual.raw) as { workflow?: { state: string }; reportStatus?: { state: string } };
  expect(payload.workflow?.state).toBe("completed");
  expect(payload.reportStatus?.state).toBe("failed");
  expect(actual.raw).not.toContain(privateValues.privateObject);
  expect(actual.raw).not.toContain(privateValues.privateFailure);

  await report.getByRole("button", { name: "帳票状態を再確認（読み取りのみ）" }).click();
  await expect(report.getByRole("alert")).toContainText("帳票生成に失敗しました");
  expect(reads).toBeGreaterThanOrEqual(3);
  expect(businessMutations, "recovery may read but must not replay the approved POST").toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);

  await switchUser(page, "ren");
  const hidden = await page.evaluate(async id => {
    const response = await fetch("/api/workhub/travel-requests/" + encodeURIComponent(id!), { credentials: "same-origin" });
    return { status: response.status, text: await response.text() };
  }, ownedId);
  expect(hidden.status).toBe(404);
  expect(hidden.text).not.toContain(purpose);
  expect(hidden.text).not.toContain(privateValues.privateObject);
  expect(hidden.text).not.toContain(privateValues.privateFailure);
});
