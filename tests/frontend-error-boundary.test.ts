import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ErrorInfo } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ErrorBoundaryFallback,
  SafeErrorBoundary,
  type ErrorBoundaryReport,
} from "../src/frontend/errors";

test("error boundary fallback renders safe generic copy and bounded correlation metadata", () => {
  const markup = renderToStaticMarkup(createElement(ErrorBoundaryFallback, {
    retry: () => undefined,
    reload: () => undefined,
    correlationId: "req-123",
  }));

  assert.match(markup, /role="alert"/);
  assert.match(markup, /Reference ID: req-123/);
  assert.match(markup, /Try again/);
  assert.match(markup, /Reload/);
  assert.equal(markup.includes("stack"), false);
});

test("error boundary reports classification and correlation only, not raw error detail", () => {
  let report: ErrorBoundaryReport | undefined;
  const boundary = new SafeErrorBoundary({
    children: null,
    boundaryId: "root-shell",
    correlationId: "req-safe",
    onReport: (value) => { report = value; },
  });

  boundary.componentDidCatch(
    new Error("secret token and private stack detail"),
    { componentStack: "private component stack" } as ErrorInfo,
  );

  assert.deepEqual(report, {
    kind: "render_error",
    boundaryId: "root-shell",
    correlationId: "req-safe",
  });
  assert.equal(JSON.stringify(report).includes("secret token"), false);
  assert.equal(JSON.stringify(report).includes("component stack"), false);
});

test("invalid correlation identifiers are omitted from safe reports", () => {
  let report: ErrorBoundaryReport | undefined;
  const boundary = new SafeErrorBoundary({
    children: null,
    boundaryId: "root\nunsafe",
    correlationId: "req\u0000unsafe",
    onReport: (value) => { report = value; },
  });

  boundary.componentDidCatch(new Error("private"), {} as ErrorInfo);
  assert.deepEqual(report, { kind: "render_error" });
});

test("render errors switch the boundary into fallback state", () => {
  assert.deepEqual(SafeErrorBoundary.getDerivedStateFromError(), { failed: true });
});
