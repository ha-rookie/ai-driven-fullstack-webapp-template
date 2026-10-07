import { defineConfig } from "@playwright/test";

const previewBaseUrl = "https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev";

export default defineConfig({
  testDir: "./e2e/preview",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["line"]],
  use: {
    baseURL: previewBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "preview-desktop-chromium",
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
    {
      name: "preview-mobile-chromium",
      use: { browserName: "chromium", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true },
    },
  ],
  outputDir: "test-results/preview-browser-smoke",
});
