import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, user: "kai" | "aoi") => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill(user);
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", {
    name: user === "kai" ? /Kai Admin/u : /Aoi Employee/u,
  })).toBeVisible();
};

test("#420 admin sees read-only Security Center without fabricated green or zero", async ({ page }) => {
  await login(page, "kai");
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("heading", { name: "セキュリティ確認センター" })).toBeVisible();
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
  await expect(panel.getByText("Finding検証結果未接続／件数は不明", { exact: false })).toBeVisible();
  await expect(panel.getByText("43 要件", { exact: false })).toBeVisible();
  await panel.getByLabel("要件・責任を検索").fill("3-1-1");
  await expect(panel.getByText("3-1-1", { exact: true })).toBeVisible();
  await expect(panel.getByText("表示 1 / 43 要件")).toBeVisible();
  const check = await page.evaluate(async () => {
    const url = "/api/admin/security/center?scopeId=workhub-company";
    const response = await fetch(url);
    const body = await response.json() as { findings: { verifiedCount: number | null }; scs: { certification: string } };
    return { status: response.status, cache: response.headers.get("cache-control"),
      count: body.findings.verifiedCount, certification: body.scs.certification,
      post: (await fetch(url, { method: "POST" })).status,
      wrongScope: (await fetch("/api/admin/security/center?scopeId=other")).status };
  });
  expect(check.status).toBe(200);
  expect(check.cache).toContain("no-store");
  expect(check.count).toBeNull();
  expect(check.certification).toBe("not-assessed");
  expect(check.post).toBe(405);
  expect(check.wrongScope).toBe(400);
});

test("#420 synthetic CI observations show failure/history independently without claiming zero or safety", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", async route => {
    const response = await route.fetch();
    const body = await response.json();
    // Synthetic browser fixture only, never a live scanner or Production result.
    const fetchedAt = "2026-10-16T12:00:00.000Z";
    const success = { runId: 9100, targetSha: "a".repeat(40), checkStatus: "completed",
      checkConclusion: "success", event: "pull_request", updatedAt: "2026-10-16T10:00:00.000Z" };
    const failure = { ...success, runId: 9101, targetSha: "b".repeat(40),
      checkConclusion: "failure", updatedAt: "2026-10-16T11:00:00.000Z" };
    body.sources[0] = { ...body.sources[0], coverageState: "unavailable", sourceHealth: "unavailable",
      ci: { state: "available", fetchedAt, latest: failure, latestSuccessfulRun: success } };
    body.sources[1] = { ...body.sources[1], coverageState: "unavailable", sourceHealth: "unavailable",
      ci: { state: "unavailable", fetchedAt, latest: null, latestSuccessfulRun: null } };
    body.sources[2].ci = { state: "available", fetchedAt, latest: null, latestSuccessfulRun: null };
    body.sources[3].ci = { state: "available", fetchedAt, latest: success, latestSuccessfulRun: success };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
  const failed = panel.getByTestId("security-source-secret_detection");
  await expect(failed).toContainText("completed / failure");
  await expect(failed).toContainText("SHA bbbbbbbbbbbb / pull_request");
  await expect(failed).toContainText("SHA aaaaaaaaaaaa / pull_request");
  await expect(failed.getByRole("link", { name: "Run #9101", exact: true }))
    .toHaveAttribute("href", "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/9101");
  await expect(failed.getByRole("link", { name: "Run #9100", exact: true })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(panel.getByTestId("security-source-dependency_audit")).toContainText("取得不能（unavailable）");
  await expect(panel.getByTestId("security-source-configuration_check")).toContainText("実行記録なし（not-run）");
  await expect(panel.getByTestId("security-source-scs_control_mapping")).toContainText("completed / success");
  await expect(panel.getByTestId("security-source-scs_control_mapping")).toContainText("unknown");
  await expect(panel.getByText("Finding検証結果未接続／件数は不明", { exact: false })).toBeVisible();
});

test("#420 unsafe run identity in API metadata fails closed before creating evidence links", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.sources[0].ci = { state: "available", fetchedAt: "2026-10-16T12:00:00.000Z", latestSuccessfulRun: null,
      latest: { runId: "unsafe-url", targetSha: "a".repeat(40), checkStatus: "completed", checkConclusion: "success",
        event: "pull_request", updatedAt: "2026-10-16T10:00:00.000Z" } };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("alert")).toContainText("状態を取得できませんでした");
  await expect(panel.getByTestId("security-center-posture")).toHaveCount(0);
  await expect(panel.getByRole("link")).toHaveCount(0);
});

test("#420 ordinary employee cannot view Security Center or read its API", async ({ page }) => {
  await login(page, "aoi");
  await page.goto("/admin");
  await expect(page.locator("#admin-security-center")).toHaveCount(0);
  const status = await page.evaluate(async () =>
    (await fetch("/api/admin/security/center?scopeId=workhub-company")).status);
  expect(status).toBe(403);
});

test("#420 failed source never renders safe or empty status", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: '{"error":{"code":"security_center_unavailable"}}',
  }));
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("alert")).toContainText("状態を取得できませんでした");
  await expect(panel.getByTestId("security-center-posture")).toHaveCount(0);
});

test("#420 unauthenticated caller receives no Security Center metadata", async ({ request }) => {
  const endpoint = "/api/admin/security/center?scopeId=workhub-company";
  const unauthenticated = await request.get(endpoint);
  expect(unauthenticated.status()).toBe(401);
  const body = await unauthenticated.text();
  expect(body).not.toContain("requirements");
  expect(body).not.toContain("evidenceReference");
  expect(body).not.toContain("checkedFindingCount");
  const duplicateScope = await request.get(endpoint + "&scopeId=workhub-company");
  expect(duplicateScope.status()).toBe(400);
  const wrongMethod = await request.post(endpoint);
  expect(wrongMethod.status()).toBe(405);
});


test("#420 UI keeps unavailable and stale verified source evidence Gray (synthetic response only)", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { sources: Array<Record<string, unknown>> };
    body.sources[0] = { ...body.sources[0], coverageState: "unavailable",
      sourceHealth: "unavailable", checkedFindingCount: null, freshness: "unknown" };
    body.sources[1] = { ...body.sources[1], coverageState: "checked", sourceHealth: "ready",
      lastSuccessfulCheckAt: "2026-10-15T00:00:00.000Z",
      evidenceValidUntil: "2026-10-15T12:00:00.000Z", checkedFindingCount: 0, freshness: "stale" };
    body.sources[2] = { ...body.sources[2], coverageState: "checked", sourceHealth: "ready",
      lastSuccessfulCheckAt: "2026-10-15T00:00:00.000Z",
      evidenceValidUntil: "2099-10-17T00:00:00.000Z", checkedFindingCount: 0, freshness: "current" };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  const rows = panel.locator(".admin-audit-table").first().locator("tbody tr");
  await expect(rows.nth(0)).toContainText("利用不可（Gray）");
  await expect(rows.nth(0)).toContainText("不明");
  await expect(rows.nth(1)).toContainText("証跡期限切れ（Gray）");
  await expect(rows.nth(1)).toContainText("0件（過去の検査値）");
  await expect(rows.nth(2)).toContainText("0件（当該ソースのみ）");
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
});

test("#420 malformed coverage contract fails closed instead of displaying a security verdict", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { sources: Array<Record<string, unknown>> };
    body.sources[0] = { ...body.sources[0], coverageState: "safe", checkedFindingCount: 0 };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("alert")).toContainText("状態を取得できませんでした");
  await expect(panel.getByTestId("security-center-posture")).toHaveCount(0);
});

test("#420 SCS requirement maps to reviewed GitHub test-source files without claiming verified evidence", async ({ page }) => {
  await login(page, "kai");
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("heading", { name: "セキュリティ確認センター" })).toBeVisible();
  await panel.getByLabel("要件・責任を検索").fill("3-1-1");
  const requirement = panel.locator("table").last().locator("tbody tr");
  await expect(requirement).toHaveCount(1);
  await expect(requirement.getByRole("link", { name: "scripts/generate-sbom.mjs" }))
    .toHaveAttribute("href", "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/blob/main/scripts/generate-sbom.mjs");
  await expect(requirement.getByRole("link", { name: "scripts/validate-lockfile-integrity.mjs" }))
    .toHaveAttribute("rel", "noopener noreferrer");
  await expect(requirement).toContainText("証跡名：SBOM generation; Lockfile integrity（未検証）");
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
  await panel.getByLabel("要件・責任を検索").fill("1-2-1");
  await expect(requirement.getByRole("link")).toHaveCount(0);
  await expect(requirement).toContainText("未登録");
});

test("#420 unsafe SCS source reference never turns into a clickable external URL", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", async route => {
    const response = await route.fetch();
    const body = await response.json() as { scs: { requirements: Array<Record<string, unknown>> } };
    const requirement = body.scs.requirements.find(r => r.id === "3-1-1");
    if (!requirement) throw new Error("missing SCS test fixture");
    requirement.testReference = "tests/admin-api.test.ts; https://outside.example/steal";
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await panel.getByLabel("要件・責任を検索").fill("3-1-1");
  const row = panel.locator("table").last().locator("tbody tr");
  await expect(row).toContainText("参照形式未対応（リンクなし）");
  await expect(row.getByRole("link")).toHaveCount(0);
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
});

test("#420 CI attention filter keeps failures, missing runs and offline sources visible without a security verdict", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", async route => {
    const response = await route.fetch();
    const body = await response.json();
    // Explicit synthetic post-authorization workflow metadata, NOT an actual scan finding.
    const fetchedAt = "2026-10-16T12:00:00.000Z";
    const oldSuccess = { runId: 9050, targetSha: "a".repeat(40), checkStatus: "completed",
      checkConclusion: "success", event: "pull_request", updatedAt: "2026-10-16T10:00:00.000Z" };
    const latestSuccess = { ...oldSuccess, runId: 9051, updatedAt: "2026-10-16T11:00:00.000Z" };
    const latestFailure = { ...oldSuccess, runId: 9052, targetSha: "b".repeat(40),
      checkConclusion: "failure", updatedAt: "2026-10-16T11:30:00.000Z" };
    body.sources[0].ci = { state: "available", fetchedAt,
      latest: latestSuccess, latestSuccessfulRun: latestSuccess };
    body.sources[1] = { ...body.sources[1], coverageState: "unavailable", sourceHealth: "unavailable",
      ci: { state: "available", fetchedAt, latest: latestFailure, latestSuccessfulRun: oldSuccess } };
    body.sources[2].ci = { state: "available", fetchedAt, latest: null, latestSuccessfulRun: null };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  const rows = panel.locator(".admin-audit-table").first().locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(panel.getByText("CI要確認 3 / 4 ソース", { exact: false })).toBeVisible();
  await expect(panel.getByTestId("security-source-secret_detection")).toContainText("CI最新Run成功（Finding未評価）");
  await expect(panel.getByTestId("security-source-dependency_audit")).toContainText("過去の成功Run（別SHA");
  await panel.getByLabel("CI要確認のソースのみ表示").check();
  await expect(rows).toHaveCount(3);
  await expect(panel.getByTestId("security-source-secret_detection")).toHaveCount(0);
  await expect(panel.getByTestId("security-source-dependency_audit")).toContainText("失敗／中断（要確認）");
  await expect(panel.getByTestId("security-source-configuration_check")).toContainText("CI実行記録なし");
  await expect(panel.getByTestId("security-source-scs_control_mapping")).toContainText("CI未接続");
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
  await panel.getByLabel("CI要確認のソースのみ表示").uncheck();
  await expect(rows).toHaveCount(4);
});

test("#420 inconsistent latest CI success and bounded success history fail closed", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", async route => {
    const response = await route.fetch();
    const body = await response.json();
    const success = { runId: 9900, targetSha: "a".repeat(40), checkStatus: "completed",
      checkConclusion: "success", event: "pull_request", updatedAt: "2026-10-16T10:00:00.000Z" };
    body.sources[0].ci = { state: "available", fetchedAt: "2026-10-16T12:00:00.000Z",
      latest: success, latestSuccessfulRun: null };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("alert")).toContainText("状態を取得できませんでした");
  await expect(panel.getByTestId("security-center-posture")).toHaveCount(0);
});
