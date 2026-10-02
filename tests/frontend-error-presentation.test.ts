import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ApiClientError } from "../src/frontend/api";
import {
  ErrorPresentation,
  toErrorViewModel,
} from "../src/frontend/errors";

const httpError = (status: number, code: string, options: {
  requestId?: string;
  issues?: Array<{ code: string; message: string; path?: string }>;
} = {}) => new ApiClientError("http", "backend detail must not render", {
  status,
  requestId: options.requestId,
  apiError: {
    error: {
      code,
      message: "backend message must not render",
      ...(options.issues ? { issues: options.issues } : {}),
    },
    requestId: options.requestId ?? "req-default",
  },
});

test("HTTP status classes remain distinct and do not reuse backend messages", () => {
  assert.equal(toErrorViewModel(httpError(401, "authentication_required")).kind, "authentication_required");
  assert.equal(toErrorViewModel(httpError(403, "forbidden")).kind, "forbidden");
  assert.equal(toErrorViewModel(httpError(404, "not_found")).kind, "not_found");
  assert.equal(toErrorViewModel(httpError(409, "conflict")).kind, "conflict");
  assert.equal(toErrorViewModel(httpError(429, "rate_limited")).kind, "rate_limited");
  assert.equal(toErrorViewModel(httpError(503, "unavailable")).kind, "service_unavailable");

  const forbidden = toErrorViewModel(httpError(403, "forbidden"));
  assert.equal(forbidden.message.includes("backend message"), false);
  assert.equal(forbidden.recovery, "none");
  assert.equal(toErrorViewModel(httpError(401, "authentication_required")).recovery, "reauthenticate");
  assert.equal(toErrorViewModel(httpError(409, "conflict")).recovery, "refresh");
  assert.equal(toErrorViewModel(httpError(429, "rate_limited")).recovery, "retry");
});

test("transport and protocol failures receive safe retry semantics", () => {
  assert.deepEqual(
    ["network", "timeout", "protocol", "aborted"].map((kind) => {
      const model = toErrorViewModel(new ApiClientError(kind as "network" | "timeout" | "protocol" | "aborted", "private detail"));
      return [model.kind, model.recovery, model.message.includes("private detail")];
    }),
    [
      ["network", "retry", false],
      ["timeout", "retry", false],
      ["protocol", "none", false],
      ["aborted", "none", false],
    ],
  );
});

test("validation maps only safe path/code data and ignores backend issue messages", () => {
  const model = toErrorViewModel(httpError(400, "validation_error", {
    requestId: "req-validation",
    issues: [
      { code: "required", message: "database says secret column missing", path: "profile.email" },
      { code: "invalid", message: "private detail", path: "../../unsafe" },
    ],
  }));

  assert.equal(model.kind, "validation");
  assert.equal(model.recovery, "correct_input");
  assert.equal(model.requestId, "req-validation");
  assert.deepEqual(model.fields, [
    { path: "profile.email", code: "required", message: "Check this value." },
  ]);
  assert.equal(JSON.stringify(model).includes("database says"), false);
  assert.equal(JSON.stringify(model).includes("private detail"), false);
});

test("copy can be replaced by project presentation without changing classification", () => {
  const model = toErrorViewModel(httpError(409, "conflict"), (kind) =>
    kind === "conflict" ? { title: "Reload required", message: "Get the latest version." } : undefined,
  );
  assert.equal(model.kind, "conflict");
  assert.equal(model.title, "Reload required");
  assert.equal(model.message, "Get the latest version.");
  assert.equal(model.recovery, "refresh");
});

test("ErrorPresentation renders semantic safe output and requestId without raw stack detail", () => {
  const model = toErrorViewModel(httpError(503, "unavailable", { requestId: "req-503" }));
  const markup = renderToStaticMarkup(ErrorPresentation({
    error: model,
    variant: "page",
    onRetry: () => undefined,
  }));

  assert.match(markup, /role="alert"/);
  assert.match(markup, /data-error-kind="service_unavailable"/);
  assert.match(markup, /Request ID: req-503/);
  assert.match(markup, /Try again/);
  assert.equal(markup.includes("backend detail must not render"), false);
  assert.equal(markup.includes("backend message must not render"), false);
});
