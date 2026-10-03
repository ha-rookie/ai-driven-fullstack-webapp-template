import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryObjectStorage,
  ObjectStorageError,
  type ObjectDescriptor,
  type ObjectIdentifier,
  type ObjectStorage,
  type PutObjectInput,
  type StoredObject,
} from "../src/shared/object-storage";
import type { IdGenerator } from "../src/shared/runtime";
import {
  createAuthorizedDownloadResponse,
  createContentDisposition,
  normalizeDisplayFilename,
  readAuthorizedMultipartUpload,
  readMultipartUpload,
  storeParsedUploadFiles,
  type ParsedUploadFile,
} from "../src/worker/http/file-transfer";

const policy = {
  maxRequestBytes: 16 * 1024,
  maxFileBytes: 8 * 1024,
  maxFileCount: 2,
  allowedMediaTypes: ["application/pdf", "text/plain", "image/*"],
} as const;

const createUploadRequest = (files: readonly File[]): Request => {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  return new Request("https://example.test/api/files", {
    method: "POST",
    body: form,
  });
};

const readJson = async (response: Response): Promise<Record<string, unknown>> =>
  response.json() as Promise<Record<string, unknown>>;

const sequenceGenerator = (...values: string[]): IdGenerator => {
  let index = 0;
  return {
    generate() {
      const value = values[index];
      if (value === undefined) throw new Error("id_generator_exhausted");
      index += 1;
      return value;
    },
  };
};

const parsedFile = (
  filename: string,
  content: string,
  mediaType = "text/plain",
): ParsedUploadFile => {
  const bytes = new TextEncoder().encode(content);
  return {
    displayFilename: filename,
    mediaType,
    byteLength: bytes.byteLength,
    body: new Blob([bytes]).stream(),
  };
};

test("valid multipart upload accepts bounded files and preserves safe Unicode display filename", async () => {
  const request = createUploadRequest([
    new File(["pdf-body"], "請求書.pdf", { type: "application/pdf" }),
    new File(["note"], "note.txt", { type: "text/plain" }),
  ]);

  const result = await readMultipartUpload(request, policy);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.files.length, 2);
  assert.equal(result.files[0]?.displayFilename, "請求書.pdf");
  assert.equal(result.files[0]?.mediaType, "application/pdf");
  assert.equal(result.files[0]?.byteLength, 8);
  assert.ok(result.requestBytesRead > 0);
  assert.equal(await new Response(result.files[0]!.body).text(), "pdf-body");
});

test("authorization is evaluated before upload body is consumed", async () => {
  const request = createUploadRequest([
    new File(["secret-body"], "secret.txt", { type: "text/plain" }),
  ]);
  assert.equal(request.bodyUsed, false);

  const result = await readAuthorizedMultipartUpload(request, policy, async () => ({
    allowed: false,
    status: 403,
    code: "forbidden",
    message: "Access denied",
  }));

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.code, "forbidden");
  assert.equal(request.bodyUsed, false);
  const untouchedBody = await request.arrayBuffer();
  assert.ok(untouchedBody.byteLength > 0);
});

test("actual streamed bytes are bounded even without Content-Length", async () => {
  const boundary = "bounded-stream";
  const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`;
  const suffix = `\r\n--${boundary}--\r\n`;
  const payload = `${prefix}${"x".repeat(4096)}${suffix}`;
  const bytes = new TextEncoder().encode(payload);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 1024));
      controller.enqueue(bytes.subarray(1024));
      controller.close();
    },
  });
  const request = new Request("https://example.test/api/files", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const result = await readMultipartUpload(request, {
    ...policy,
    maxRequestBytes: 1500,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.status, 413);
  assert.equal(result.ok ? undefined : result.code, "payload_too_large");
});

test("declared oversized request is rejected before parsing", async () => {
  const request = new Request("https://example.test/api/files", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=x",
      "content-length": "99999",
    },
    body: "--x--\r\n",
  });

  const result = await readMultipartUpload(request, policy);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.status, 413);
});

test("file count, file size, empty file, MIME and text parts are rejected", async () => {
  const tooMany = await readMultipartUpload(
    createUploadRequest([
      new File(["a"], "a.txt", { type: "text/plain" }),
      new File(["b"], "b.txt", { type: "text/plain" }),
      new File(["c"], "c.txt", { type: "text/plain" }),
    ]),
    policy,
  );
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.ok ? undefined : tooMany.code, "too_many_files");

  const tooLarge = await readMultipartUpload(
    createUploadRequest([new File(["x".repeat(64)], "big.txt", { type: "text/plain" })]),
    { ...policy, maxFileBytes: 16 },
  );
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.ok ? undefined : tooLarge.code, "payload_too_large");

  const empty = await readMultipartUpload(
    createUploadRequest([new File([], "empty.txt", { type: "text/plain" })]),
    policy,
  );
  assert.equal(empty.ok, false);
  assert.equal(empty.ok ? undefined : empty.code, "empty_file");

  const mime = await readMultipartUpload(
    createUploadRequest([new File(["bin"], "file.bin", { type: "application/octet-stream" })]),
    policy,
  );
  assert.equal(mime.ok, false);
  assert.equal(mime.ok ? undefined : mime.code, "unsupported_media_type");

  const form = new FormData();
  form.append("comment", "not accepted at shared boundary");
  form.append("files", new File(["a"], "a.txt", { type: "text/plain" }));
  const withText = await readMultipartUpload(
    new Request("https://example.test/api/files", { method: "POST", body: form }),
    policy,
  );
  assert.equal(withText.ok, false);
  assert.equal(withText.ok ? undefined : withText.code, "malformed_multipart");
});

test("filename and Content-Disposition neutralize path and header injection", () => {
  assert.equal(normalizeDisplayFilename("../../secret.pdf"), null);
  assert.equal(normalizeDisplayFilename("evil\r\nX-Test: injected.pdf"), null);
  assert.equal(normalizeDisplayFilename("請求書.pdf"), "請求書.pdf");

  const disposition = createContentDisposition("請求書 2026.pdf");
  assert.match(disposition, /^attachment; filename="[A-Za-z0-9._-]+"; filename\*=UTF-8''/);
  assert.match(disposition, /%E8%AB%8B%E6%B1%82%E6%9B%B8/);
  assert.equal(disposition.includes("\r"), false);
  assert.equal(disposition.includes("\n"), false);
});

test("parsed upload files are stored with generated IDs and streams", async () => {
  const storage = new InMemoryObjectStorage({ environment: "test" });
  const firstId = "11111111-1111-4111-8111-111111111111";
  const secondId = "22222222-2222-4222-8222-222222222222";

  const result = await storeParsedUploadFiles(
    [parsedFile("a.txt", "alpha"), parsedFile("b.txt", "beta")],
    storage,
    sequenceGenerator(firstId, secondId),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.files.map((file) => file.identifier), [firstId, secondId]);
  assert.equal(await new Response((await storage.get(firstId))!.body).text(), "alpha");
  assert.equal(await new Response((await storage.get(secondId))!.body).text(), "beta");
});

test("multi-file storage failure compensates earlier successful writes", async () => {
  const inner = new InMemoryObjectStorage({ environment: "test" });
  let puts = 0;
  const storage: ObjectStorage = {
    put: async (input: PutObjectInput): Promise<ObjectDescriptor> => {
      puts += 1;
      if (puts === 2) throw new ObjectStorageError("provider_error", "provider detail");
      return inner.put(input);
    },
    get: (identifier: ObjectIdentifier): Promise<StoredObject | null> => inner.get(identifier),
    head: (identifier: ObjectIdentifier): Promise<ObjectDescriptor | null> => inner.head(identifier),
    delete: (identifier: ObjectIdentifier): Promise<void> => inner.delete(identifier),
  };
  const firstId = "33333333-3333-4333-8333-333333333333";
  const secondId = "44444444-4444-4444-8444-444444444444";

  const result = await storeParsedUploadFiles(
    [parsedFile("a.txt", "alpha"), parsedFile("b.txt", "beta")],
    storage,
    sequenceGenerator(firstId, secondId),
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.code, "storage_unavailable");
  assert.equal(await inner.get(firstId), null);
});

test("download denies access before touching storage and can hide forbidden as not found", async () => {
  let storageTouched = false;
  const storage: ObjectStorage = {
    async put() { throw new Error("unused"); },
    async get() { storageTouched = true; return null; },
    async head() { storageTouched = true; return null; },
    async delete() { storageTouched = true; },
  };

  const response = await createAuthorizedDownloadResponse({
    request: new Request("https://example.test/api/files/secret"),
    requestId: "req-forbidden",
    storage,
    hideForbiddenAsNotFound: true,
    resolve: async () => ({ kind: "forbidden" }),
  });

  assert.equal(response.status, 404);
  assert.equal(storageTouched, false);
  const body = await readJson(response);
  assert.equal(body.requestId, "req-forbidden");
  assert.deepEqual(body.error, { code: "resource_not_found", message: "Resource not found" });
});

test("authorized download streams private object with safe headers", async () => {
  const storage = new InMemoryObjectStorage({ environment: "test" });
  const identifier = "55555555-5555-4555-8555-555555555555";
  await storage.put({
    identifier,
    body: new TextEncoder().encode("download-body"),
    metadata: { contentType: "application/pdf" },
  });

  const response = await createAuthorizedDownloadResponse({
    request: new Request("https://example.test/api/files/document"),
    requestId: "req-download",
    storage,
    resolve: async () => ({
      kind: "authorized",
      identifier,
      displayFilename: "請求書 2026.pdf",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-request-id"), "req-download");
  assert.match(response.headers.get("content-disposition") ?? "", /filename\*=UTF-8''/);
  assert.equal(await response.text(), "download-body");
});

test("storage provider errors become 503 standard error envelopes without provider detail", async () => {
  const identifier = "66666666-6666-4666-8666-666666666666";
  const storage: ObjectStorage = {
    async put() { throw new Error("unused"); },
    async get() { throw new ObjectStorageError("provider_error", "R2 private internal detail"); },
    async head() { return null; },
    async delete() {},
  };

  const response = await createAuthorizedDownloadResponse({
    request: new Request("https://example.test/api/files/document"),
    requestId: "req-storage-failure",
    storage,
    resolve: async () => ({
      kind: "authorized",
      identifier,
      displayFilename: "document.pdf",
    }),
  });

  assert.equal(response.status, 503);
  const body = await readJson(response);
  assert.equal(body.requestId, "req-storage-failure");
  assert.deepEqual(body.error, {
    code: "storage_unavailable",
    message: "File storage is unavailable",
  });
  assert.equal(JSON.stringify(body).includes("R2"), false);
});
