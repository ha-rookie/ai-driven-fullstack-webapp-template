import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyApiChange,
  createApiVersionPolicy,
  createCollectionPaginationMeta,
  parseCollectionQuery,
  resolveApiVersion,
  type CollectionQueryContract,
} from "../src/shared/api";

const collectionContract: CollectionQueryContract<
  "created" | "name" | "id",
  "status" | "owner",
  { readonly token: string }
> = {
  defaultLimit: 25,
  maxLimit: 100,
  allowedSortKeys: ["created", "name", "id"],
  defaultSort: { key: "created", direction: "desc" },
  stableTieBreaker: { key: "id", direction: "asc" },
  allowedFilterKeys: ["status", "owner"],
  decodeCursor: (value) => value.startsWith("v1:")
    ? { token: value.slice(3) }
    : null,
  validateFilter: (key, values) => {
    if (key === "status" && values.some((value) => !["open", "closed"].includes(value))) {
      return [{
        code: "collection_query.invalid_filter",
        path: "filter.status",
        message: "status is not allowed",
      }];
    }
    return [];
  },
};

test("collection query applies bounded defaults and a stable tie-breaker", () => {
  const result = parseCollectionQuery(new URLSearchParams(), collectionContract);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.value, {
    cursor: null,
    limit: 25,
    sort: [
      { key: "created", direction: "desc" },
      { key: "id", direction: "asc" },
    ],
    filters: {},
  });
});

test("collection query parses verified cursor, public sort tokens and repeated filters", () => {
  const params = new URLSearchParams();
  params.set("cursor", "v1:cursor-2");
  params.set("limit", "50");
  params.set("sort", "name");
  params.set("direction", "asc");
  params.append("filter.status", "open");
  params.append("filter.status", "closed");
  params.set("filter.owner", "team-a");

  const result = parseCollectionQuery(params, collectionContract);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.value, {
    cursor: { token: "cursor-2" },
    limit: 50,
    sort: [
      { key: "name", direction: "asc" },
      { key: "id", direction: "asc" },
    ],
    filters: {
      status: ["open", "closed"],
      owner: ["team-a"],
    },
  });
});

test("collection query fails closed for unverified cursor, excessive limit and unknown public fields", () => {
  const params = new URLSearchParams();
  params.set("cursor", "client-made-cursor");
  params.set("limit", "9999");
  params.set("sort", "raw_sql_column");
  params.set("direction", "sideways");
  params.set("filter.internal_status_column", "secret");

  const result = parseCollectionQuery(params, collectionContract);
  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.deepEqual(result.issues.map((item) => item.code), [
    "collection_query.invalid_cursor",
    "collection_query.invalid_limit",
    "collection_query.unknown_sort",
    "collection_query.invalid_sort_direction",
    "collection_query.unknown_filter",
  ]);
});

test("collection query maps duplicate and project-specific filter validation to standard issues", () => {
  const params = new URLSearchParams("limit=10&limit=20&filter.status=unknown");
  const result = parseCollectionQuery(params, collectionContract);
  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.deepEqual(result.issues, [
    {
      code: "collection_query.duplicate_parameter",
      path: "limit",
      message: "limit must be provided at most once",
    },
    {
      code: "collection_query.invalid_filter",
      path: "filter.status",
      message: "status is not allowed",
    },
  ]);
});

test("pagination metadata derives hasMore from the presence of the next opaque cursor", () => {
  assert.deepEqual(createCollectionPaginationMeta(25, "v1:next"), {
    nextCursor: "v1:next",
    limit: 25,
    hasMore: true,
  });
  assert.deepEqual(createCollectionPaginationMeta(25, null), {
    nextCursor: null,
    limit: 25,
    hasMore: false,
  });
  assert.throws(() => createCollectionPaginationMeta(0, null), /limit/);
});

test("API change classifier distinguishes compatible additions from breaking contract changes", () => {
  assert.equal(classifyApiChange("add_endpoint"), "non_breaking");
  assert.equal(classifyApiChange("add_optional_response_field"), "non_breaking");
  assert.equal(classifyApiChange("remove_endpoint"), "breaking");
  assert.equal(classifyApiChange("make_request_field_required"), "breaking");
  assert.equal(classifyApiChange("change_pagination_semantics"), "breaking");
});

test("API version policy is transport-neutral and resolves default/current/deprecated versions", () => {
  const policy = createApiVersionPolicy({
    strategy: { kind: "header", headerName: "X-Api-Version" },
    supportedVersions: ["2026-01", "2026-10"],
    currentVersion: "2026-10",
    defaultVersion: "2026-10",
    deprecations: [{
      version: "2026-01",
      message: "Migrate to 2026-10",
      removalCondition: "Remove only after registered clients have migrated and release evidence records approval",
      migrationGuide: "docs/API_GOVERNANCE.md#migration-example",
    }],
  });

  assert.deepEqual(resolveApiVersion(null, policy), {
    ok: true,
    version: "2026-10",
    deprecation: null,
  });
  assert.deepEqual(resolveApiVersion("2026-01", policy), {
    ok: true,
    version: "2026-01",
    deprecation: policy.deprecations[0],
  });
  assert.deepEqual(resolveApiVersion("2099", policy), {
    ok: false,
    code: "unsupported_api_version",
    requestedVersion: "2099",
    supportedVersions: ["2026-01", "2026-10"],
  });
});

test("version policy rejects ambiguous or unsafe configuration", () => {
  assert.throws(() => createApiVersionPolicy({
    strategy: { kind: "none" },
    supportedVersions: ["v1", "v2"],
    currentVersion: "v2",
    defaultVersion: "v2",
  }), /strategy none/);

  assert.throws(() => createApiVersionPolicy({
    strategy: { kind: "header", headerName: "bad header" },
    supportedVersions: ["v1"],
    currentVersion: "v1",
    defaultVersion: "v1",
  }), /headerName/);
});

test("API governance documentation keeps the compatibility and environment invariants explicit", () => {
  const document = readFileSync("docs/API_GOVERNANCE.md", "utf8");
  assert.match(document, /silent breaking change/i);
  assert.match(document, /Preview.*Production/i);
  assert.match(document, /stable tie-breaker/i);
  assert.match(document, /Project MUST verify decoded cursor/i);
});
