import { expect, test, type Page } from "@playwright/test";

// #350 E: local browser interception only. Search recovery never runs a
// business mutation or tests unrelated Preview authentication incidents.
async function openSearch(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "ユーザーID", exact: true }).fill("aoi");
  await page.getByLabel("パスワード", { exact: true }).fill("Workhub-Demo-2026!");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Aoi Employeeさん/u })).toBeVisible();
  const search = page.getByRole("search");
  const query = search.getByRole("textbox", { name: "WORKHUBを検索" });
  await query.fill("該当しない社内文書");
  await search.getByRole("combobox", { name: "検索カテゴリ" }).selectOption("documents");
  return { search, query };
}

for (const [name, invalidBody] of [
  ["null results", '{"results":null}'],
  ["invalid result row", '{"results":[{"title":"不完全なレコード"}]}'],
] as const) {
  test(`malformed HTTP 200 ${name} is unavailable, not zero, and GET-only recovery works`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let unavailable = true;
    let reads = 0;
    let workflowPosts = 0;
    page.on("request", request => {
      if (request.method() === "POST" && /\/api\/workhub\/workflows\//u.test(new URL(request.url()).pathname)) workflowPosts++;
    });
    await page.route("**/api/workhub/search?**", route => {
      reads++;
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: unavailable ? invalidBody : '{"results":[]}',
      });
    });
    const { search, query } = await openSearch(page);
    await search.getByRole("button", { name: "検索", exact: true }).click();
    const results = page.getByRole("region", { name: "検索結果", exact: true });
    await expect(results.getByRole("alert")).toContainText("0件とは限りません");
    await expect(results.getByText("まだ、この条件では見つかりませんでした。")).toHaveCount(0);
    await expect(results.getByRole("link")).toHaveCount(0);
    unavailable = false;
    await results.getByRole("button", { name: "再検索" }).click();
    await expect(results.getByRole("alert")).toHaveCount(0);
    await expect(results.getByText("まだ、この条件では見つかりませんでした。")).toBeVisible();
    await expect(results).toContainText("カテゴリ：文書");
    await expect(query).toHaveValue("該当しない社内文書");
    expect(reads, "search recovery should re-read the same query").toBeGreaterThanOrEqual(2);
    expect(workflowPosts, "search recovery must not mutate business state").toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test("search-provider outage removes previously rendered results and recovers without posting", async ({ page }) => {
  let fail = false;
  let searchGets = 0;
  await page.route("**/api/workhub/search?**", route => {
    searchGets++;
    return route.fulfill(fail
      ? { status: 502, contentType: "application/json", body: '{"error":{"message":"unavailable"}}' }
      : { status: 200, contentType: "application/json", body: JSON.stringify({
        results: [{
          resourceType: "workhub_document", resourceId: "doc-fixture", category: "documents",
          title: "テスト文書", snippet: "閲覧可能な検索結果",
          actionTarget: "/#workhub-document-doc-fixture",
        }],
      }) });
  });
  const { search } = await openSearch(page);
  const results = page.getByRole("region", { name: "検索結果", exact: true });
  await search.getByRole("button", { name: "検索", exact: true }).click();
  await expect(results.getByRole("link", { name: /テスト文書/u })).toBeVisible();
  fail = true;
  await search.getByRole("button", { name: "検索", exact: true }).click();
  await expect(results.getByRole("alert")).toContainText("0件とは限りません");
  await expect(results.getByRole("link")).toHaveCount(0);
  fail = false;
  await results.getByRole("button", { name: "再検索" }).click();
  await expect(results.getByRole("link", { name: /テスト文書/u })).toBeVisible();
  expect(searchGets).toBe(3);
});
