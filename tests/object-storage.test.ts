import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryObjectStorage,
  ObjectStorageError,
  R2ObjectStorage,
  createObjectIdentifier,
  normalizeObjectWriteMetadata,
  toEnvironmentObjectKey,
} from "../src/shared/object-storage";
import { createFixedClock, type IdGenerator } from "../src/shared/runtime";

const readStreamText = async (
  stream: ReadableStream<Uint8Array>,
): Promise<string> => new Response(stream).text();

const objectId = "550e8400-e29b-41d4-a716-446655440000";

test("generated object identifiers are opaque and path separators are rejected", () => {
  const generator: IdGenerator = { generate: () => objectId };
  assert.equal(createObjectIdentifier(generator), objectId);
  assert.equal(
    toEnvironmentObjectKey("preview", objectId),
    `objects/preview/${objectId}`,
  );

  assert.throws(
    () => createObjectIdentifier({ generate: () => "../../client-file.pdf" }),
    (error: unknown) =>
      error instanceof ObjectStorageError && error.code === "invalid_identifier",
  );
});

test("custom metadata is bounded and rejects secret-like keys", () => {
  assert.deepEqual(normalizeObjectWriteMetadata({
    contentType: " application/pdf ",
    custom: { document_kind: "invoice" },
  }), {
    contentType: "application/pdf",
    custom: { document_kind: "invoice" },
  });

  assert.throws(
    () => normalizeObjectWriteMetadata({ custom: { access_token: "secret" } }),
    (error: unknown) =>
      error instanceof ObjectStorageError && error.code === "invalid_metadata",
  );
});

test("in-memory storage supports private put/get/head/delete semantics", async () => {
  const storage = new InMemoryObjectStorage({
    environment: "test",
    clock: createFixedClock("2026-10-03T00:00:00.000Z"),
  });

  const descriptor = await storage.put({
    identifier: objectId,
    body: new TextEncoder().encode("hello"),
    metadata: {
      contentType: "text/plain",
      custom: { document_kind: "example" },
    },
  });

  assert.equal(descriptor.identifier, objectId);
  assert.equal(descriptor.byteLength, 5);
  assert.equal(descriptor.uploadedAt?.toISOString(), "2026-10-03T00:00:00.000Z");
  assert.equal(descriptor.contentType, "text/plain");
  assert.deepEqual(descriptor.customMetadata, { document_kind: "example" });
  assert.equal(descriptor.etag.length, 64);

  const head = await storage.head(objectId);
  assert.deepEqual(head, descriptor);

  const stored = await storage.get(objectId);
  assert.notEqual(stored, null);
  assert.equal(await readStreamText(stored!.body), "hello");

  await storage.delete(objectId);
  assert.equal(await storage.get(objectId), null);
  assert.equal(await storage.head(objectId), null);

  await storage.delete(objectId);
});

test("overwrite is forbidden by default and replace can require the current etag", async () => {
  const storage = new InMemoryObjectStorage({ environment: "test" });
  const first = await storage.put({
    identifier: objectId,
    body: new TextEncoder().encode("v1"),
  });

  await assert.rejects(
    () => storage.put({
      identifier: objectId,
      body: new TextEncoder().encode("unexpected overwrite"),
    }),
    (error: unknown) =>
      error instanceof ObjectStorageError && error.code === "already_exists",
  );

  await assert.rejects(
    () => storage.put({
      identifier: objectId,
      body: new TextEncoder().encode("v2"),
      overwrite: "replace",
      ifMatchEtag: "wrong-etag",
    }),
    (error: unknown) =>
      error instanceof ObjectStorageError && error.code === "precondition_failed",
  );

  const second = await storage.put({
    identifier: objectId,
    body: new TextEncoder().encode("v2"),
    overwrite: "replace",
    ifMatchEtag: first.etag,
  });

  assert.notEqual(second.etag, first.etag);
  const stored = await storage.get(objectId);
  assert.equal(await readStreamText(stored!.body), "v2");
});

test("stream bodies are accepted without requiring remote object storage", async () => {
  const storage = new InMemoryObjectStorage({ environment: "local" });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("stream-"));
      controller.enqueue(new TextEncoder().encode("body"));
      controller.close();
    },
  });

  await storage.put({ identifier: objectId, body: stream });
  const stored = await storage.get(objectId);
  assert.equal(await readStreamText(stored!.body), "stream-body");
});

test("R2 adapter prefixes keys by environment and uses conditional create by default", async () => {
  const calls: Array<{
    key: string;
    options: unknown;
  }> = [];

  const fakeR2Object = {
    key: `objects/preview/${objectId}`,
    version: "version-1",
    size: 3,
    etag: "etag-1",
    httpEtag: '"etag-1"',
    checksums: {},
    uploaded: new Date("2026-10-03T00:00:00.000Z"),
    httpMetadata: { contentType: "text/plain" },
    customMetadata: { document_kind: "example" },
    storageClass: "Standard",
  } as unknown as R2Object;

  const bucket = {
    put: async (key: string, _value: unknown, options: unknown) => {
      calls.push({ key, options });
      return fakeR2Object;
    },
  } as unknown as R2Bucket;

  const storage = new R2ObjectStorage({ environment: "preview", bucket });
  const result = await storage.put({
    identifier: objectId,
    body: new Uint8Array([1, 2, 3]),
    metadata: {
      contentType: "text/plain",
      custom: { document_kind: "example" },
    },
  });

  assert.equal(calls[0]?.key, `objects/preview/${objectId}`);
  assert.deepEqual(calls[0]?.options, {
    httpMetadata: { contentType: "text/plain" },
    customMetadata: { document_kind: "example" },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  assert.equal(result.identifier, objectId);
  assert.equal(result.etag, "etag-1");
});

test("R2 conditional failure maps to stable storage errors without provider details", async () => {
  const bucket = {
    put: async () => null,
  } as unknown as R2Bucket;
  const storage = new R2ObjectStorage({ environment: "production", bucket });

  await assert.rejects(
    () => storage.put({
      identifier: objectId,
      body: new Uint8Array([1]),
    }),
    (error: unknown) =>
      error instanceof ObjectStorageError &&
      error.code === "already_exists" &&
      !error.message.includes("R2"),
  );
});
