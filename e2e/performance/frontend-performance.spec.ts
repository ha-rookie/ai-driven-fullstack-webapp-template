import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const numericEnv = (name: string): number | null => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      cls: 0,
      lcpMs: null as number | null,
    };

    Object.defineProperty(window, "__templatePerformance", {
      value: state,
      configurable: false,
      writable: false,
    });

    try {
      const clsObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput && typeof shift.value === "number") state.cls += shift.value;
        }
      });
      clsObserver.observe({ type: "layout-shift", buffered: true });
    } catch {
      // Unsupported metrics remain unavailable rather than being guessed.
    }

    try {
      const lcpObserver = new PerformanceObserver(list => {
        const entries = list.getEntries();
        const latest = entries.at(-1);
        if (latest) state.lcpMs = latest.startTime;
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Unsupported metrics remain unavailable rather than being guessed.
    }
  });
});

test("records production-build browser performance evidence", async ({ page }, testInfo) => {
  let sameOriginRequestCount = 0;
  const targetOrigin = "http://127.0.0.1:4174";

  page.on("request", request => {
    try {
      if (new URL(request.url()).origin === targetOrigin) sameOriginRequestCount += 1;
    } catch {
      // Ignore non-URL browser internals.
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/API health:/)).toContainText("ok");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(100);

  const browser = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const state = (window as unknown as {
      __templatePerformance?: { cls: number; lcpMs: number | null };
    }).__templatePerformance;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];

    return {
      navigation: navigation
        ? {
            domContentLoadedMs: navigation.domContentLoadedEventEnd - navigation.startTime,
            loadEventMs: navigation.loadEventEnd - navigation.startTime,
            responseEndMs: navigation.responseEnd - navigation.startTime,
          }
        : null,
      lcpMs: state?.lcpMs ?? null,
      cls: state ? Number(state.cls.toFixed(6)) : null,
      resourceCount: resources.length,
      transferSizeBytes: resources.reduce((sum, resource) => sum + (resource.transferSize || 0), 0),
    };
  });

  const thresholds = {
    maxLcpMs: numericEnv("FRONTEND_MAX_LCP_MS"),
    maxCls: numericEnv("FRONTEND_MAX_CLS"),
    maxInitialRequests: numericEnv("FRONTEND_MAX_INITIAL_REQUESTS"),
  };

  const checks = [
    {
      name: "maxLcpMs",
      actual: browser.lcpMs,
      limit: thresholds.maxLcpMs,
      configured: thresholds.maxLcpMs !== null,
      status: thresholds.maxLcpMs === null
        ? "not-configured"
        : browser.lcpMs !== null && browser.lcpMs <= thresholds.maxLcpMs ? "pass" : "fail",
    },
    {
      name: "maxCls",
      actual: browser.cls,
      limit: thresholds.maxCls,
      configured: thresholds.maxCls !== null,
      status: thresholds.maxCls === null
        ? "not-configured"
        : browser.cls !== null && browser.cls <= thresholds.maxCls ? "pass" : "fail",
    },
    {
      name: "maxInitialRequests",
      actual: sameOriginRequestCount,
      limit: thresholds.maxInitialRequests,
      configured: thresholds.maxInitialRequests !== null,
      status: thresholds.maxInitialRequests === null
        ? "not-configured"
        : sameOriginRequestCount <= thresholds.maxInitialRequests ? "pass" : "fail",
    },
  ];

  const thresholdStatus = checks.some(check => check.status === "fail") ? "fail" : "pass";
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: testInfo.project.name,
    measurementKind: "local-production-build-browser",
    browser,
    sameOriginRequestCount,
    inp: {
      status: "not-measured",
      reason: "Template root page has no representative Product interaction; Project scenarios must define INP evidence.",
    },
    thresholdAssessment: {
      configured: checks.some(check => check.configured),
      status: thresholdStatus,
      checks,
    },
    interpretation: {
      productionRum: false,
      note: "Local browser evidence is a regression signal and must not be described as Production Core Web Vitals.",
    },
  };

  const outputDir = path.resolve("artifacts/performance");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, `frontend-browser-${testInfo.project.name}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );

  expect(browser.navigation).not.toBeNull();
  expect(sameOriginRequestCount).toBeGreaterThan(0);
  if (evidence.thresholdAssessment.configured) expect(evidence.thresholdAssessment.status).toBe("pass");
});
