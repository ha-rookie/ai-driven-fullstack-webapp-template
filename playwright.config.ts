import { defineConfig } from "@playwright/test";

const harnessUrl = "/e2e/harness/?view=home";

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 412, height: 915 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run workhub:seed:local && npm run dev -- --host 127.0.0.1 --port 4173",
    url: `http://127.0.0.1:4173${harnessUrl}`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  outputDir: "test-results/browser-e2e",
});
