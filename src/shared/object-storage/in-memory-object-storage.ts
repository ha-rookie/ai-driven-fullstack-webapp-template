import { systemClock, type Clock, type RuntimeEnvironment } from "../runtime";
import {
  ObjectStorageError,
  assertObjectIdentifier,
  assertPutPreconditions,
  normalizeObjectWriteMetadata,
  toEnvironmentObjectKey,
  type ObjectDescriptor,
  type ObjectStorage,
  type ObjectStorageWriteBody,
  type PutObjectInput,
  type StoredObject,
} from "./object-storage";

interface InMemoryRecord {
  readonly body: Uint8Array;
  readonly descriptor: ObjectDescriptor;
}

const copyBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

const readBody = async (body: ObjectStorageWriteBody): Promise<Uint8Array> => {
  if (body instanceof Uint8Array) return copyBytes(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = copyBytes(value);
      chunks.push(chunk);
      totalLength += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
};

const bodyStream = (bytes: Uint8Array): ReadableStream<Uint8Array> => {
  const snapshot = copyBytes(bytes);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(snapshot);
      controller.close();
    },
  });
};

export interface InMemoryObjectStorageOptions {
  readonly environment: RuntimeEnvironment;
  readonly clock?: Clock;
}

export class InMemoryObjectStorage implements ObjectStorage {
  private readonly records = new Map<string, InMemoryRecord>();
  private readonly clock: Clock;

  constructor(private readonly options: InMemoryObjectStorageOptions) {
    this.clock = options.clock ?? systemClock;
  }

  async put(input: PutObjectInput): Promise<ObjectDescriptor> {
    assertPutPreconditions(input);
    const key = toEnvironmentObjectKey(this.options.environment, input.identifier);
    const existing = this.records.get(key);
    const overwrite = input.overwrite ?? "forbid";

    if (existing !== undefined && overwrite === "forbid") {
      throw new ObjectStorageError(
        "already_exists",
        "Object already exists and overwrite is forbidden",
      );
    }

    if (
      input.ifMatchEtag !== undefined &&
      (existing === undefined || existing.descriptor.etag !== input.ifMatchEtag)
    ) {
      throw new ObjectStorageError(
        "precondition_failed",
        "Object replace precondition did not match",
      );
    }

    const body = await readBody(input.body);
    const metadata = normalizeObjectWriteMetadata(input.metadata);
    const descriptor: ObjectDescriptor = Object.freeze({
      identifier: input.identifier,
      byteLength: body.byteLength,
      etag: await sha256Hex(body),
      uploadedAt: this.clock.now(),
      ...(metadata.contentType === undefined
        ? {}
        : { contentType: metadata.contentType }),
      customMetadata: metadata.custom,
    });

    this.records.set(key, {
      body: copyBytes(body),
      descriptor,
    });

    return descriptor;
  }

  async get(identifier: string): Promise<StoredObject | null> {
    assertObjectIdentifier(identifier);
    const key = toEnvironmentObjectKey(this.options.environment, identifier);
    const record = this.records.get(key);
    if (record === undefined) return null;

    return {
      ...record.descriptor,
      body: bodyStream(record.body),
    };
  }

  async head(identifier: string): Promise<ObjectDescriptor | null> {
    assertObjectIdentifier(identifier);
    const key = toEnvironmentObjectKey(this.options.environment, identifier);
    return this.records.get(key)?.descriptor ?? null;
  }

  async delete(identifier: string): Promise<void> {
    assertObjectIdentifier(identifier);
    const key = toEnvironmentObjectKey(this.options.environment, identifier);
    this.records.delete(key);
  }
}
