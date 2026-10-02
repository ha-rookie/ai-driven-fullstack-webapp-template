import { expect, test } from "@playwright/test";

const harness = "/e2e/harness/index.html?view=home";

const waitForAuthenticated = async (page: import("@playwright/test").Page) => {
  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  await expect(page.getByTestId("protected-content")).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.goto(harness);
  await waitForAuthenticated(page);
});

test("major navigation participates in browser Back/Forward while filters do not", async ({ page }) => {
  await expect(page.getByTestId("current-view")).toHaveText("home");

  await page.getByRole("button", { name: "List" }).click();
  await page.getByRole("button", { name: "Detail" }).click();
  await expect(page.getByTestId("current-view")).toHaveText("detail");
  await expect(page).toHaveURL(/view=detail$/);

  await page.goBack();
  await expect(page.getByTestId("current-view")).toHaveText("list");
  await page.goBack();
  await expect(page.getByTestId("current-view")).toHaveText("home");
  await page.goForward();
  await expect(page.getByTestId("current-view")).toHaveText("list");

  await page.getByLabel("Filter").fill("recent");
  await expect(page.getByTestId("filter-value")).toHaveText("recent");
  await page.goBack();
  await expect(page.getByTestId("current-view")).toHaveText("home");
});

test("deep link and reload keep one canonical application view", async ({ page }) => {
  await page.goto("/e2e/harness/index.html?view=detail");
  await waitForAuthenticated(page);
  await expect(page.getByTestId("current-view")).toHaveText("detail");
  const historyLength = await page.evaluate(() => window.history.length);

  await page.reload();
  await waitForAuthenticated(page);
  await expect(page.getByTestId("current-view")).toHaveText("detail");
  await expect.poll(() => page.evaluate(() => window.history.length)).toBe(historyLength);
});

test("dirty state can block browser Back and restore the current entry", async ({ page }) => {
  await page.getByRole("button", { name: "List" }).click();
  await page.getByRole("button", { name: "Detail" }).click();
  await page.getByLabel("Unsaved navigation state").check();
  await page.getByRole("button", { name: "Block next leave" }).click();

  await page.goBack();
  await expect.poll(() => page.getByTestId("current-view").textContent()).toBe("detail");
  await expect(page).toHaveURL(/view=detail$/);

  await page.getByLabel("Unsaved navigation state").uncheck();
  await page.goBack();
  await expect(page.getByTestId("current-view")).toHaveText("list");
});

test("stable authenticated UI does not regress to pending during synchronization", async ({ page }) => {
  await page.getByRole("button", { name: "Synchronize slowly" }).click();

  await expect(page.getByTestId("auth-status")).toHaveText("authenticated");
  await expect(page.getByTestId("auth-syncing")).toHaveText("true");
  await expect(page.getByTestId("protected-content")).toBeVisible();
  await expect(page.getByTestId("protected-pending")).toHaveCount(0);

  await expect(page.getByTestId("auth-syncing")).toHaveText("false");
  await page.getByRole("button", { name: "Simulate logout" }).click();
  await expect(page.getByTestId("auth-status")).toHaveText("unauthenticated");
  await expect(page.getByTestId("protected-content")).toHaveCount(0);
  await expect(page.getByTestId("login-intent")).toContainText("/login");

  await page.getByRole("button", { name: "Authenticate" }).click();
  await waitForAuthenticated(page);
});

test("duplicate mutation submit executes once", async ({ page }) => {
  await page.getByLabel("Draft").fill("saved-once");
  await page.getByRole("button", { name: "delay", exact: true }).click();
  const save = page.getByRole("button", { name: "Save", exact: true });

  await Promise.all([save.click(), save.click()]);

  await expect(page.getByTestId("mutation-phase")).toHaveText("success");
  await expect(page.getByTestId("persisted-value")).toHaveText("saved-once");
  await expect(page.getByTestId("mutation-executions")).toHaveText("1");
});

test("409 conflict keeps the user draft and exposes the latest persisted value", async ({ page }) => {
  await page.getByLabel("Draft").fill("my-unsaved-edit");
  await page.getByRole("button", { name: "conflict", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByTestId("mutation-phase")).toHaveText("conflict");
  await expect(page.getByTestId("persisted-value")).toHaveText("server-latest");
  await expect(page.getByLabel("Draft")).toHaveValue("my-unsaved-edit");
  await expect(page.getByTestId("mutation-executions")).toHaveText("1");
});

test("runtime 401 preserves the form, reauthenticates, and does not replay the mutation", async ({ page }) => {
  await page.getByLabel("Draft").fill("keep-this-work");
  await page.getByRole("button", { name: "auth", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByLabel("Draft")).toHaveValue("keep-this-work");
  await expect(page.getByTestId("mutation-phase")).toHaveText("failed");
  await expect(page.getByTestId("mutation-executions")).toHaveText("1");
  await expect(page.getByTestId("recovery-status")).toHaveText("recovered");
  await expect(page.getByText("Authentication was restored. Review your changes and submit again when ready.")).toBeVisible();
  await expect(page.getByTestId("protected-content")).toBeVisible();
});

test("reference harness has keyboard-reachable controls and semantic landmarks", async ({ page }) => {
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Reference navigation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authentication" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Navigation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mutation safety" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? "")).toBe("BUTTON");
});
