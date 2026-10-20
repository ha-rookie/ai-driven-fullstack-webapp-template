import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("#433 Reference documentation and source links resolve to repository files", () => {
  const siteSource = readFileSync(resolve("src/reference/site/ReferenceSite.tsx"), "utf8");
  // Use the same literal pointers that feed the public Reference cards and entry links.
  // File presence is verifiable without a network request or a new metadata registry.
  const pointers = new Set([
    ...[...siteSource.matchAll(/(?:recipe|code|test|source):\s*"([^"]+)"/gu)].map((match) => match[1]),
    ...[...siteSource.matchAll(/\bsource\("([^"]+)"\)/gu)].map((match) => match[1]),
    ...[...siteSource.matchAll(/<ExternalEvidence path="([^"]+)"/gu)].map((match) => match[1]),
  ]);
  expect(pointers.size, "all Reference evidence pointers must be discovered").toBeGreaterThanOrEqual(21);
  for (const path of pointers) {
    expect(path, "Reference pointer must be repository-relative: " + path)
      .toMatch(/^(?:docs|src|e2e|tests)\/|^README\.md$/u);
    expect(existsSync(resolve(path)), "Broken Reference evidence link: " + path).toBe(true);
  }
  expect(siteSource).not.toContain("申請・承認、認証・認可、架空の復旧判断の3つの代表例です。");
});

test("#433 all 18 original WORKHUB / Admin scenarios have an explicit mapping", () => {
  const map = readFileSync(resolve("docs/reference/WORKHUB_SCENARIO_MAP.md"), "utf8");
  const rows = [...map.matchAll(/^\\| (S(?:0[1-9]|1[0-8])) \\| \`(scenario\\.[a-z0-9.-]+)\` \\|/gmu)];
  expect(rows).toHaveLength(18);
  expect(new Set(rows.map((row) => row[1])).size).toBe(18);
  expect(new Set(rows.map((row) => row[2])).size).toBe(18);
  for (let index = 0; index < 18; index++) {
    expect(rows[index][1]).toBe("S" + String(index + 1).padStart(2, "0"));
  }
  expect(map).toContain("既存18件すべてのStable ID");
  expect(map).toContain("GitHub checkboxの更新はブロック");
});

test("#433 public Reference provides real Docs → Demo → Source links without API calls", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) apiCalls.push(request.method() + " " + path);
  });

  await page.goto("/reference");
  await expect(page.getByRole("heading", { level: 1, name: /業務Webアプリの設計を/u })).toBeVisible();
  await expect(page.getByRole("heading", { name: "読みたい場所から始める" })).toBeVisible();
  await expect(page.locator(".reference-capability")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "権限付き検索" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "PDF帳票の生成" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CSV入出力" })).toBeVisible();

  const search = page.locator("#reference-search");
  await expect(search.getByRole("link", { name: "WORKHUBで出張申請を検索する（ログインが必要） →" }))
    .toHaveAttribute("href", "/");
  await expect(search.getByRole("link", { name: "Test / Evidence ↗" }))
    .toHaveAttribute("href", /workhub-travel-request\.spec\.ts$/u);
  for (const id of ["report", "csv"]) {
    const capability = page.locator("#reference-" + id);
    await expect(capability.getByText("操作デモなし（設計・ソース・テストを参照）")).toBeVisible();
    await expect(capability.getByRole("link", { name: "Recipe / 設計 ↗" })).toBeVisible();
    await expect(capability.getByRole("link", { name: "Source / Contract ↗" })).toBeVisible();
    await expect(capability.getByRole("link", { name: "Test / Evidence ↗" })).toBeVisible();
    await expect(capability.getByRole("link", { name: /WORKHUBで/u })).toHaveCount(0);
  }
  await expect(page.getByRole("heading", { name: "申請と承認" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "認証と認可" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Backupと復旧判断" })).toBeVisible();
  await expect(page.getByText("REFERENCE DEMO（架空復旧）")).toBeVisible();
  await expect(page.getByText("Production Restore、Remote D1復元", { exact: false })).toBeVisible();

  const workflow = page.locator("#reference-workflow");
  await expect(workflow.getByRole("link", { name: "WORKHUBで操作する（ログインが必要） →" }))
    .toHaveAttribute("href", "/");
  await expect(workflow.getByRole("link", { name: "Recipe / 設計 ↗" }))
    .toHaveAttribute("href", /docs\/recipes\/REFERENCE_TRAVEL_REQUEST\.md$/u);
  await expect(workflow.getByRole("link", { name: "Source / Contract ↗" }))
    .toHaveAttribute("href", /src\/reference\/workhub\/travel-request\/service\.ts$/u);
  await expect(workflow.getByRole("link", { name: "Test / Evidence ↗" }))
    .toHaveAttribute("href", /e2e\/tests\/workhub-travel-request\.spec\.ts$/u);

  const recovery = page.locator("#reference-recovery");
  await expect(recovery.getByRole("link", { name: "Recovery判断デモを見る（読取専用） →" }))
    .toHaveAttribute("href", "/showcase/#showcase-recovery");
  await expect(recovery.getByRole("link", { name: "Test / Evidence ↗" }))
    .toHaveAttribute("href", /tests\/recovery-showcase\.test\.ts$/u);
  await expect(page.getByRole("link", { name: "Reference Siteの未完了条件を見る ↗" }))
    .toHaveAttribute("href", /issues\/433$/u);
  const scenarios = page.locator("#reference-scenarios");
  await expect(scenarios.getByRole("link", { name: /既存18シナリオの対応表/u }))
    .toHaveAttribute("href", /docs\/reference\/WORKHUB_SCENARIO_MAP\.md$/u);
  await expect(scenarios.getByRole("heading", { name: "業務の場面から、実装までたどる" })).toBeVisible();
  for (const scenario of ["return", "expense", "search"]) {
    const card = page.locator("#reference-scenario-" + scenario);
    await expect(card.getByRole("link", { name: "ショーケースの該当場面を見る →" }))
      .toHaveAttribute("href", "/showcase?scenario=" + scenario + "#showcase-tour");
    await expect(card.getByRole("link", { name: "Source ↗" }))
      .toHaveAttribute("href", /\/blob\/main\/src\//u);
    await expect(card.getByRole("link", { name: "Browser E2E ↗" }))
      .toHaveAttribute("href", /\/blob\/main\/e2e\/tests\//u);
  }

  const status = page.locator("#reference-status");
  await expect(status.getByRole("heading", { name: "開発状況はGitHubの正本で確認する" })).toBeVisible();
  await expect(status.getByText("既存の6つの代表Capabilityと3つの業務シナリオ", { exact: false })).toBeVisible();
  await expect(status.getByRole("link", { name: "Reference Siteの受入条件 ↗" }))
    .toHaveAttribute("href", /issues\/433$/u);
  await expect(status.getByRole("link", { name: "実装計画・優先順位 ↗" }))
    .toHaveAttribute("href", /issues\/132$/u);
  await expect(status.getByRole("link", { name: "正式System Testの状況 ↗" }))
    .toHaveAttribute("href", /issues\/694$/u);
  await expect(status.getByText("進捗率や公開状態は固定表示せず", { exact: false })).toBeVisible();
  expect(apiCalls, "public Reference must not request private API, sessions or remote mutations").toEqual([]);
});

test("#433 published Reference links, anchors and status pointers are not broken or stale", async ({ page }) => {
  await page.goto("/reference");

  const repo = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template";
  const hrefs = await page.locator(".reference-site a[href]").evaluateAll((anchors) =>
    anchors
      .map((anchor) => anchor.getAttribute("href"))
      .filter((href): href is string => href !== null)
  );
  const paths = new Set<string>();
  const issues = new Set(["132", "433", "694"]);
  const scenarios = new Set(["return", "expense", "search"]);

  for (const href of hrefs) {
    if (href.startsWith("#")) {
      const target = decodeURIComponent(href.slice(1));
      await expect(page.locator(`[id="${target}"]`), "Broken Reference section anchor: " + href).toHaveCount(1);
      continue;
    }

    if (href.startsWith("/")) {
      const url = new URL(href, "http://reference.local");
      expect(["/", "/reference", "/showcase", "/showcase/"], "Unsupported Reference route: " + href)
        .toContain(url.pathname);
      if (url.searchParams.has("scenario")) {
        expect(scenarios.has(url.searchParams.get("scenario") ?? ""), "Unknown Showcase scenario: " + href)
          .toBe(true);
        expect(url.hash).toBe("#showcase-tour");
      } else if (url.hash) {
        expect(url.pathname).toMatch(/^\/showcase\/?$/u);
        expect(url.hash).toBe("#showcase-recovery");
      }
      continue;
    }

    const githubFilePrefix = repo + "/blob/main/";
    if (href.startsWith(githubFilePrefix)) {
      const path = decodeURIComponent(href.slice(githubFilePrefix.length));
      expect(existsSync(resolve(path)), "Broken published Github file: " + href).toBe(true);
      paths.add(path);
      continue;
    }

    const issuePrefix = repo + "/issues/";
    const issueId = href.startsWith(issuePrefix) ? href.slice(issuePrefix.length) : null;
    if (issueId && /^[0-9]+$/u.test(issueId)) {
      expect(issues.has(issueId), "Unverified canonical Issue pointer: " + href).toBe(true);
      continue;
    }
    expect(href, "Unexpected Reference external link").toBe(repo);
  }

  expect(hrefs.length, "public links must be enumerated").toBeGreaterThan(35);
  expect(paths.size, "all 20 current documentation / source / test pointers remain published").toBe(21);
  await expect(page.locator(".reference-capability")).toHaveCount(6);
  await expect(page.locator("#reference-scenarios .reference-entry")).toHaveCount(3);
  await expect(page.locator("#reference-status")).toContainText("既存の6つの代表Capabilityと3つの業務シナリオ");

  await page.goto("/showcase");
  await expect(page.locator("#showcase-tour")).toHaveCount(1);
  await expect(page.locator("#showcase-recovery")).toHaveCount(1);
});

test("#433 public Showcase links to Reference on mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/showcase");
  await page.getByRole("link", { name: "設計リファレンス →" }).click();
  await expect(page).toHaveURL(/\/reference$/u);
  await expect(page.getByRole("heading", { level: 1, name: /業務Webアプリの設計を/u })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Reference Site ナビゲーション" })).toBeVisible();
  await expect(page.locator(".reference-capability")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("link", { name: "業務シナリオ" }).click();
  await page.locator("#reference-scenario-search")
    .getByRole("link", { name: "ショーケースの該当場面を見る →" }).click();
  await expect(page).toHaveURL(/\/showcase\?scenario=search#showcase-tour$/u);
  await expect(page.locator(".showcase-tour-detail").getByRole("heading", { name: "検索・帳票も、現在の権限で確認する" })).toBeVisible();
  await page.goto("/showcase?scenario=unknown#showcase-tour");
  await expect(page.locator(".showcase-tour-detail").getByRole("heading", { name: "社員が「出張したい」から始める" })).toBeVisible();
  await page.goto("/reference/");
  await expect(page.getByRole("heading", { level: 1, name: /業務Webアプリの設計を/u })).toBeVisible();
});
