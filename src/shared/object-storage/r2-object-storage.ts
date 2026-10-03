import type { RuntimeEnvironment } from "../runtime";
import {
  ObjectStorageError,
  assertObjectIdentifier,
  assertPutPreconditions,
  normalizeObjectWriteMetadata,
  toEnvironmentObjectKey,
  type ObjectDescriptor,
  type ObjectStorage,
  type PutObjectInput,
  type StoredObject,
} from "./object-storage";

export interface R2ObjectStorageOptions {
  readonly environment: RuntimeEnvironment;
  readonly bucket: R2Bucket;
}

const descriptorFromR2 = (
  identifier: string,
  object: R2Object,
): ObjectDescriptor => ({
  identifier,
  byteLength: object.size,
  etag: object.etag,
  uploadedAt: object.uploaded,
  ...(object.httpMetadata?.contentType === undefined
    ? {}
    : { contentType: object.httpMetadata.contentType }),
  customMetadata: Object.freeze({ ...(object.customMetadata ?? {}) }),
});

const providerFailure = (): ObjectStorageError =>
  new ObjectStorageError(
    "provider_error",
    "Object storage provider operation failed",
  );

const runProviderOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ObjectStorageError) throw error;
    throw providerFailure();
  }
};

export class R2ObjectStorage implements ObjectStorage {
  constructor(private readonly options: R2ObjectStorageOptions) {}

  async put(input: PutObjectInput): Promise<ObjectDescriptor> {
    assertPutPreconditions(input);
    const key = toEnvironmentObjectKey(this.options.environment, input.identifier);
    const overwrite = input.overwrite ?? "forbid";
    const metadata = normalizeObjectWriteMetadata(input.metadata);

    const onlyIf =
      input.ifMatchEtag !== undefined
        ? { etagMatches: input.ifMatchEtag }
        : overwrite === "forbid"
          ? { etagDoesNotMatch: "*" }
          : undefined;

    const object = await runProviderOperation(() =>
      this.options.bucket.put(key, input.body, {
        ...(metadata.contentType === undefined
          ? {}
          : { httpMetadata: { contentType: metadata.contentType } }),
        ...(Object.keys(metadata.custom).length === 0
          ? {}
          : { customMetadata: { ...metadata.custom } }),
        ...(onlyIf === undefined ? {} : { onlyIf }),
      }),
    );

    if (object === null) {
      throw new ObjectStorageError(
        overwrite === "forbid" ? "already_exists" : "precondition_failed",
        overwrite === "forbid"
          ? "Object already exists and overwrite is forbidden"
          : "Object replace precondition did not match",
      );
    }

    return descriptorFromR2(input.identifier, object);
  }

  async get(identifier: string): Promise<StoredObject | null> {
    assertObjectIdentifier(identifier);
    const key = toEnvironmentObjectKey(this.options.environment, identifier);
    const object = await runProviderOperation(() => this.options.bucket.get(key));
    if (object === null) return null;

    return {
      ...descriptorFromR2(identifier, object),
      body: object.body,
    };
  }

  async head(identifier: string): Promise<ObjectDescriptor | null> {
    assertObjectIdentifier(identifier);
    const key = toEnvironmentObjectKey(this.options.environment, identifier);
    const object = await runProviderOperation(() => this.options.bucket.head(key));
    return object === null ? null : descriptorFromR2(identifier, object);
  }

  async delete(identifier: string): Promise<void> {
    assertObjectIdentifier(identifier);
    const key = toEnvironmentObjectKey(this.options.environment, identifier);
    await runProviderOperation(() => this.options.bucket.delete(key));
  }
}
