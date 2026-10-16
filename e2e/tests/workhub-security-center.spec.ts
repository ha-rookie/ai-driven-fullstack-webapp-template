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

test("#420 admin inspects the actual GitHub CI step from latest run without interpreting it as Finding", async ({ page }) => {
  await login(page, "kai");
  const run = { runId: 7301, targetSha: "a".repeat(40), checkStatus: "completed",
    checkConclusion: "success", event: "pull_request", updatedAt: "2026-10-16T10:00:00.000Z" };
  let detailQueries = 0;
  await page.route("**/api/admin/security/center?**", async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.has("sourceId")) {
      detailQueries++;
      expect(requestUrl.searchParams.get("sourceId")).toBe("secret_detection");
      expect(requestUrl.searchParams.has("runId")).toBe(false);
      await route.fulfill({ json: { schemaVersion: 1,
        sourceId: "secret_detection", stepCode: "secret_scan",
        runId: run.runId, targetSha: run.targetSha,
        state: "observed", conclusion: "success" } });
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    body.sources[0].ci = { state: "available", fetchedAt: "2026-10-16T12:00:00.000Z",
      latest: run, latestSuccessfulRun: run };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
  const row = panel.getByTestId("security-source-secret_detection");
  await expect(row).toContainText("CI最新Run成功（Finding未評価）");
  await expect(row.getByText("検査ステップを確認", { exact: true })).toBeVisible();
  expect(detailQueries).toBe(0);
  await row.getByRole("button", { name: "検査ステップを確認" }).click();
  await expect(row.getByTestId("security-step-secret_detection")).toContainText("GitHub CIステップ: success");
  await expect(row.getByTestId("security-step-secret_detection")).toContainText("Run #7301");
  await expect(row.getByTestId("security-step-secret_detection")).toContainText("Finding結果ではありません");
  expect(detailQueries).toBe(1);
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
});

test("#420 injected stale or wrong-source CI step evidence fails closed", async ({ page }) => {
  await login(page, "kai");
  const run = { runId: 7302, targetSha: "b".repeat(40), checkStatus: "completed",
    checkConclusion: "failure", event: "pull_request", updatedAt: "2026-10-16T10:00:00.000Z" };
  await page.route("**/api/admin/security/center?**", async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.has("sourceId")) {
      await route.fulfill({ json: { schemaVersion: 1, sourceId: "dependency_audit",
        stepCode: "secret_scan", runId: run.runId, targetSha: run.targetSha,
        state: "observed", conclusion: "success", logs_url: "https://evil.test" } });
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    body.sources[0] = { ...body.sources[0], coverageState: "unavailable", sourceHealth: "unavailable",
      ci: { state: "available", fetchedAt: "2026-10-16T12:00:00.000Z",
        latest: run, latestSuccessfulRun: null } };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  const row = panel.getByTestId("security-source-secret_detection");
  await row.getByRole("button", { name: "検査ステップを確認" }).click();
  await expect(row.getByRole("alert")).toContainText("照合に失敗");
  await expect(row.getByTestId("security-step-secret_detection")).toHaveCount(0);
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
});

test("#420 source-verified Finding contracts show independent severity/category/status and safe evidence codes", async ({ page }) => {
  await login(page, "kai");
  // Fetch once while authenticated; do not keep an upstream APIResponse alive
  // inside the route callback where browser navigation can dispose it.
  const baseline = await page.evaluate(async () =>
    (await fetch("/api/admin/security/center?scopeId=workhub-company")).json());
  await page.route("**/api/admin/security/center?**", async route => {
    const body = structuredClone(baseline);
    // Synthetic post-auth UI fixture only. Production endpoint remains NOT CONNECTED.
    const asOf: string = body.observedAt;
    const earlier = (minutes: number) => new Date(Date.parse(asOf) - minutes * 60_000).toISOString();
    const later = (minutes: number) => new Date(Date.parse(asOf) + minutes * 60_000).toISOString();
    for (const index of [0, 1]) {
      body.sources[index] = { ...body.sources[index],
        coverageState: "checked", sourceHealth: "ready",
        lastSuccessfulCheckAt: asOf, evidenceValidUntil: later(60),
        checkedFindingCount: 1, freshness: "current" };
    }
    const evidence = [{ kind: "ci", code: "dependency_alert", referenceId: "evidence_one" }];
    const first = { sourceId: "secret_detection", ruleId: "rule_alpha",
      category: "identity", severity: "high", status: "open",
      detectedAt: earlier(120), lastObservedAt: earlier(60), assessedAt: asOf,
      evidence, remediationCode: "review_access", auditRequestId: "CF-123.NRT", riskDisposition: "none" };
    const second = { sourceId: "dependency_audit", ruleId: "rule_beta",
      category: "dependency", severity: "low", status: "accepted-risk",
      detectedAt: earlier(120), lastObservedAt: earlier(60), assessedAt: asOf,
      evidence, remediationCode: "update_dependency",
      exception: { reasonCode: "mitigation_documented", approvalRef: "approval_one", expiresAt: earlier(5) },
      riskDisposition: "accepted-expired" };
    body.findings = { state: "verified", items: [first, second], verifiedCount: 2 };
    await route.fulfill({ json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  const table = panel.getByTestId("security-findings-table");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table).toContainText("evidence_one");
  await expect(table).toContainText("例外期限切れ（承認無効）");
  const correlationLink = table.getByRole("link", { name: /監査ログをリクエストIDで照合/u });
  await expect(correlationLink).toHaveCount(1);
  await expect(correlationLink).toHaveAttribute("href",
    "/admin?auditRequestId=CF-123.NRT#admin-audit-and-security");
  await panel.getByLabel("Finding重大度").selectOption("high");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("rule_alpha");
  await panel.getByLabel("Finding重大度").selectOption("all");
  await panel.getByLabel("Finding分類").selectOption("dependency");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("rule_beta");
  await panel.getByLabel("Finding分類").selectOption("all");
  await panel.getByLabel("Finding状態").selectOption("open");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("rule_alpha");
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
  const expectedRequest = page.waitForRequest(req =>
    req.url().includes("/api/admin/audit?") && new URL(req.url()).searchParams.get("requestId") === "CF-123.NRT");
  await correlationLink.click();
  await expectedRequest;
  await expect(page.locator("#admin-audit-and-security")
    .getByLabel("監査リクエストID（完全一致）")).toHaveValue("CF-123.NRT");
});

test("#420 untrusted synthetic Finding payload is rejected instead of rendered", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", async route => {
    const response = await route.fetch();
    const body = await response.json();
    const at: string = body.observedAt;
    body.sources[0] = { ...body.sources[0], coverageState: "checked", sourceHealth: "ready",
      lastSuccessfulCheckAt: at, evidenceValidUntil: new Date(Date.parse(at) + 3600000).toISOString(),
      checkedFindingCount: 1, freshness: "current" };
    body.findings = { state: "verified", verifiedCount: 1, items: [{
      sourceId: "secret_detection", ruleId: "rule_alpha",
      category: "identity", severity: "critical", status: "open",
      detectedAt: at, lastObservedAt: at, assessedAt: at,
      evidence: [{ kind: "ci", code: "dependency_alert", referenceId: "evidence_one",
        url: "https://untrusted.test" }], riskDisposition: "none",
      message: "secret provider raw log",
    }] };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await expect(panel.getByRole("alert")).toContainText("状態を取得できませんでした");
  await expect(panel.getByTestId("security-findings-table")).toHaveCount(0);
  await expect(panel).not.toContainText("secret provider raw log");
});

test("#420 administrator can search real Audit viewer by exact request ID without a Finding feed", async ({ page }) => {
  await login(page, "kai");
  await page.goto("/admin");
  const audit = page.locator("#admin-audit-and-security");
  await expect(audit.getByRole("heading", { name: "監査ログ" })).toBeVisible();
  const field = audit.getByLabel("監査リクエストID（完全一致）");
  await field.fill("request-1234_test.NRT");
  const request = page.waitForRequest(req => req.url().includes("/api/admin/audit?")
    && new URL(req.url()).searchParams.get("requestId") === "request-1234_test.NRT");
  await audit.getByRole("button", { name: "絞り込む" }).click();
  await request;
  await expect(field).toHaveValue("request-1234_test.NRT");
  await expect(page.locator("#admin-security-center").getByTestId("security-finding-unconnected")).toBeVisible();
});

test("#420 admin sees an actual-shaped failed CI control, not a scanner vulnerability or global zero", async ({ page }) => {
  await login(page, "kai");
  const sha = "a".repeat(40);
  const updatedAt = "2026-10-16T10:00:00.000Z";
  const run = { runId: 73942, targetSha: sha, checkStatus: "completed",
    checkConclusion: "failure", event: "pull_request", updatedAt };
  await page.route("**/api/admin/security/center?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("sourceId")) {
      const assessedAt = new Date().toISOString();
      await route.fulfill({ json: {
        schemaVersion: 1, sourceId: "secret_detection", stepCode: "secret_scan",
        runId: 73942, targetSha: sha, state: "observed", conclusion: "failure",
        controlFinding: {
          ruleId: "ci_step_failure", sourceId: "secret_detection",
          category: "data", severity: "high", status: "open",
          detectedAt: updatedAt, lastObservedAt: updatedAt, assessedAt,
          resourceRef: "commit_" + sha.slice(0, 12),
          evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "run_73942" }],
          remediationCode: "review_control", riskDisposition: "none",
        },
      } });
      return;
    }
    const res = await route.fetch();
    const body = await res.json();
    body.sources[0] = { ...body.sources[0],
      coverageState: "unavailable", sourceHealth: "unavailable",
      ci: { state: "available", fetchedAt: body.observedAt, latest: run, latestSuccessfulRun: null } };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  const row = panel.getByTestId("security-source-secret_detection");
  await row.getByRole("button", { name: "検査ステップを確認" }).click();
  await expect(row.getByTestId("security-control-finding-secret_detection")).toContainText("CI制御異常");
  await expect(row.getByTestId("security-control-finding-secret_detection")).toContainText("run_73942");
  await expect(row.getByTestId("security-control-finding-secret_detection")).toContainText("脆弱性診断結果ではありません");
  await expect(panel.getByTestId("security-finding-unconnected")).toBeVisible();
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
});

test("#420 injected CI control failure with wrong source/Run evidence fails closed", async ({ page }) => {
  await login(page, "kai");
  const sha = "b".repeat(40);
  const updatedAt = "2026-10-16T10:00:00.000Z";
  const run = { runId: 73943, targetSha: sha, checkStatus: "completed",
    checkConclusion: "failure", event: "pull_request", updatedAt };
  await page.route("**/api/admin/security/center?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("sourceId")) {
      await route.fulfill({ json: {
        schemaVersion: 1, sourceId: "secret_detection", stepCode: "secret_scan",
        runId: 73943, targetSha: sha, state: "observed", conclusion: "failure",
        controlFinding: {
          ruleId: "ci_step_failure", sourceId: "secret_detection", category: "data",
          severity: "high", status: "open", detectedAt: updatedAt,
          lastObservedAt: updatedAt, assessedAt: new Date().toISOString(),
          resourceRef: "commit_" + sha.slice(0, 12),
          evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "run_73942" }],
          remediationCode: "review_control", riskDisposition: "none",
        },
      } });
      return;
    }
    const res = await route.fetch();
    const body = await res.json();
    body.sources[0] = { ...body.sources[0],
      coverageState: "unavailable", sourceHealth: "unavailable",
      ci: { state: "available", fetchedAt: body.observedAt, latest: run, latestSuccessfulRun: null } };
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/admin");
  const row = page.getByTestId("security-source-secret_detection");
  await row.getByRole("button", { name: "検査ステップを確認" }).click();
  await expect(row.getByRole("alert")).toContainText("照合に失敗");
  await expect(row.getByTestId("security-control-finding-secret_detection")).toHaveCount(0);
});


test("#420 admin checks OSV runtime advisories without changing global Finding posture", async ({ page }) => {
  await login(page, "kai");
  let calls = 0;
  await page.route("**/api/admin/security/center?**", async route => {
    if (new URL(route.request().url()).searchParams.get("dependencyAdvisories") !== "runtime") {
      await route.continue(); return;
    }
    calls++;
    await route.fulfill({ json: {
      schemaVersion: 1, scope: "runtime-lock-only", source: "OSV", state: "verified",
      checkedAt: new Date(Date.now()-1500).toISOString(),
      checkedPackages: 12, advisoryCount: 2,
      advisories: [
        { packageRef: "pkg_08", advisoryId: "GHSA-vqj2-4v8m-8vrq" },
        { packageRef: "pkg_07", advisoryId: "CVE-2026-12345" },
      ],
    } });
  });
  await page.goto("/admin");
  const panel = page.getByTestId("security-osv-runtime-panel");
  await expect(panel).toContainText("未照会");
  expect(calls).toBe(0);
  await panel.getByRole("button", { name: "本番依存12件の脆弱性情報を照会" }).click();
  await expect(panel.getByTestId("security-osv-verified")).toContainText("アドバイザリ 2 件");
  await expect(panel.getByText("react / 19.3.0")).toBeVisible();
  await expect(panel.getByText("tslib / 1.14.1")).toBeVisible();
  await expect(panel.getByRole("link", { name: "GHSA-vqj2-4v8m-8vrq" }))
    .toHaveAttribute("href", "https://osv.dev/vulnerability/GHSA-vqj2-4v8m-8vrq");
  await expect(page.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
  await expect(page.getByTestId("security-finding-unconnected")).toBeVisible();
  expect(calls).toBe(1);
});

test("#420 malicious OSV advisory ID fails closed and cannot become a positive result", async ({ page }) => {
  await login(page, "kai");
  await page.route("**/api/admin/security/center?**", async route => {
    if (new URL(route.request().url()).searchParams.get("dependencyAdvisories") !== "runtime") {
      await route.continue(); return;
    }
    await route.fulfill({ json: {
      schemaVersion: 1, source: "OSV", scope: "runtime-lock-only",
      state: "verified", checkedAt: new Date().toISOString(),
      checkedPackages: 12, advisoryCount: 1,
      advisories: [{ packageRef: "pkg_08", advisoryId: "https://untrusted.test/secret" }],
    } });
  });
  await page.goto("/admin");
  const panel = page.getByTestId("security-osv-runtime-panel");
  await panel.getByRole("button", { name: "本番依存12件の脆弱性情報を照会" }).click();
  await expect(panel.getByRole("alert")).toContainText("OSV照会不可（Gray）");
  await expect(panel.getByTestId("security-osv-verified")).toHaveCount(0);
  await expect(panel).not.toContainText("untrusted.test");
  await expect(page.getByTestId("security-finding-unconnected")).toBeVisible();
});

test("#420 admin manually projects an observed CI control failure through the real Finding UI boundary", async ({ page }) => {
  await login(page, "kai");
  const baseline = await page.evaluate(async () => {
    const response = await fetch("/api/admin/security/center?scopeId=workhub-company");
    return response.json();
  });
  const now: string = baseline.observedAt;
  const prior = new Date(Date.parse(now) - 60_000).toISOString();
  const run = { runId: 1042, targetSha: "a".repeat(40),
    checkStatus: "completed", checkConclusion: "failure", event: "pull_request",
    updatedAt: prior };
  baseline.sources[0] = { ...baseline.sources[0],
    coverageState: "checked", sourceHealth: "degraded",
    lastSuccessfulCheckAt: now, evidenceValidUntil: new Date(Date.parse(now) + 300_000).toISOString(),
    checkedFindingCount: 1, freshness: "current",
    ci: { state: "available", fetchedAt: now, latest: run, latestSuccessfulRun: null } };
  baseline.findings = { state: "verified", verifiedCount: 1,
    items: [{ sourceId: "secret_detection", ruleId: "ci_step_failure",
      category: "data", severity: "high", status: "open",
      resourceRef: "commit_" + run.targetSha.slice(0, 12),
      detectedAt: prior, lastObservedAt: prior, assessedAt: now,
      evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "run_1042" }],
      remediationCode: "review_control", riskDisposition: "none" }] };
  // Synthetic transport fixture; real production data must come from the authorized Worker reader.
  await page.route("**/api/admin/security/center?**", async route => {
    if (new URL(route.request().url()).searchParams.get("controlFindings") === "latest") {
      await route.fulfill({ json: baseline }); return;
    }
    await route.continue();
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await panel.getByRole("button", { name: "実CI制御異常Findingを照合" }).click();
  await expect(panel.getByTestId("security-control-lookup")).toContainText("実RunとStepの失敗");
  const table = panel.getByTestId("security-findings-table");
  await expect(table).toContainText("ci_step_failure");
  await expect(table).toContainText("control_check_failed");
  await expect(table).toContainText("run_1042");
  await panel.getByLabel("Finding重大度").selectOption("low");
  await expect(table.locator("tbody tr")).toHaveCount(0);
  await panel.getByLabel("Finding重大度").selectOption("high");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(panel.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
});

test("#420 no confirmed CI control failure is never displayed as Finding zero", async ({ page }) => {
  await login(page, "kai");
  const fallback = await page.evaluate(async () =>
    (await fetch("/api/admin/security/center?scopeId=workhub-company")).json());
  await page.route("**/api/admin/security/center?**", async route => {
    if (new URL(route.request().url()).searchParams.get("controlFindings") !== "latest") {
      await route.continue(); return;
    }
    await route.fulfill({ json: fallback });
  });
  await page.goto("/admin");
  const panel = page.locator("#admin-security-center");
  await panel.getByRole("button", { name: "実CI制御異常Findingを照合" }).click();
  await expect(panel.getByTestId("security-control-lookup")).toContainText("未検査・成功Runを脆弱性0件とは扱いません");
  await expect(panel.getByTestId("security-finding-unconnected")).toBeVisible();
});

test("#420 OSV source-verified npm advisory projects Finding, evidence and independent filters", async ({ page }) => {
  await login(page, "kai");
  const checkedAt = new Date(Date.now() - 3000).toISOString();
  const advisory = { packageRef: "pkg_08", advisoryId: "GHSA-vqj2-4v8m-8vrq" };
  let batchCalls = 0; let detailCalls = 0;
  await page.route("**/api/admin/security/center?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("dependencyAdvisories") === "runtime") {
      batchCalls++;
      await route.fulfill({ json: {
        schemaVersion: 1, source: "OSV", scope: "runtime-lock-only",
        state: "verified", checkedAt, checkedPackages: 12, advisoryCount: 1,
        advisories: [advisory],
      } }); return;
    }
    if (url.searchParams.get("osvFindings") === "runtime") {
      detailCalls++;
      const assessedAt = new Date().toISOString();
      await route.fulfill({ json: {
        schemaVersion: 1, source: "OSV", scope: "runtime-lock-only",
        state: "verified", checkedAt, checkedPackages: 12,
        coverage: {
          sourceId: "dependency_audit", coverageState: "checked", sourceHealth: "ready",
          checkedFindingCount: 1, lastSuccessfulCheckAt: checkedAt,
          evidenceValidUntil: new Date(Date.parse(checkedAt) + 300_000).toISOString(),
          freshness: "current",
        },
        findings: { state: "verified", verifiedCount: 1, items: [{
          ruleId: "osv_ghsa_vqj2_4v8m_8vrq", sourceId: "dependency_audit",
          category: "dependency", severity: "high", status: "open",
          resourceRef: "pkg_08", detectedAt: checkedAt, lastObservedAt: checkedAt,
          assessedAt, riskDisposition: "none",
          evidence: [{ kind: "dependency", code: "dependency_alert",
            referenceId: "pkg_08_ghsa_vqj2_4v8m_8vrq" }],
          remediationCode: "update_dependency",
        }] },
      } }); return;
    }
    await route.continue();
  });
  await page.goto("/admin");
  const panel = page.getByTestId("security-osv-runtime-panel");
  await panel.getByRole("button", { name: "本番依存12件の脆弱性情報を照会" }).click();
  await expect(panel.getByTestId("security-osv-verified")).toContainText("アドバイザリ 1 件");
  await panel.getByRole("button", { name: "OSV原票の重大度とFindingを照合" }).click();
  const verified = panel.getByTestId("security-osv-finding-verified");
  await expect(verified).toContainText("検証済OSV Finding 1 件");
  const table = panel.getByTestId("security-osv-finding-table");
  await expect(table).toContainText("react / 19.3.0");
  await expect(table).toContainText("osv_ghsa_vqj2_4v8m_8vrq");
  await expect(table).toContainText("pkg_08_ghsa_vqj2_4v8m_8vrq");
  await panel.getByLabel("OSV重大度").selectOption("low");
  await expect(table.locator("tbody tr")).toHaveCount(0);
  await panel.getByLabel("OSV重大度").selectOption("high");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await panel.getByLabel("OSV分類").selectOption("identity");
  await expect(table.locator("tbody tr")).toHaveCount(0);
  await panel.getByLabel("OSV分類").selectOption("dependency");
  await panel.getByLabel("OSV状態").selectOption("resolved");
  await expect(table.locator("tbody tr")).toHaveCount(0);
  await panel.getByLabel("OSV状態").selectOption("open");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
  expect(batchCalls).toBe(1); expect(detailCalls).toBe(1);
});

test("#420 OSV malformed detailed Finding cannot masquerade as verified source evidence", async ({ page }) => {
  await login(page, "kai");
  const at = new Date(Date.now() - 2000).toISOString();
  await page.route("**/api/admin/security/center?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("dependencyAdvisories") === "runtime") {
      await route.fulfill({ json: {
        schemaVersion: 1, source: "OSV", scope: "runtime-lock-only",
        state: "verified", checkedAt: at, checkedPackages: 12, advisoryCount: 1,
        advisories: [{ packageRef: "pkg_08", advisoryId: "GHSA-vqj2-4v8m-8vrq" }],
      } }); return;
    }
    if (url.searchParams.get("osvFindings") === "runtime") {
      await route.fulfill({ json: {
        schemaVersion: 1, source: "OSV", scope: "runtime-lock-only",
        state: "verified", checkedAt: at, checkedPackages: 12,
        coverage: {
          sourceId: "dependency_audit", coverageState: "checked", sourceHealth: "ready",
          checkedFindingCount: 1, lastSuccessfulCheckAt: at,
          evidenceValidUntil: new Date(Date.parse(at) + 300_000).toISOString(),
          freshness: "current",
        }, findings: { state: "verified", verifiedCount: 1, items: [{
          ruleId: "osv_ghsa_vqj2_4v8m_8vrq", sourceId: "dependency_audit",
          category: "dependency", severity: "unknown", status: "open",
          resourceRef: "pkg_08", detectedAt: at, lastObservedAt: at,
          assessedAt: new Date().toISOString(), riskDisposition: "none",
          evidence: [{ kind: "dependency", code: "dependency_alert",
            referenceId: "raw_upstream_secret", url: "https://untrusted.test" }],
          remediationCode: "update_dependency", rawDetails: "do not show untrusted data",
        }] },
      } }); return;
    }
    await route.continue();
  });
  await page.goto("/admin");
  const panel = page.getByTestId("security-osv-runtime-panel");
  await panel.getByRole("button", { name: "本番依存12件の脆弱性情報を照会" }).click();
  await panel.getByRole("button", { name: "OSV原票の重大度とFindingを照合" }).click();
  await expect(panel.getByTestId("security-osv-finding-unavailable")).toBeVisible();
  await expect(panel.getByTestId("security-osv-finding-table")).toHaveCount(0);
  await expect(panel).not.toContainText("do not show untrusted data");
  await expect(page.getByTestId("security-center-posture")).toContainText("未評価（Gray）");
});
