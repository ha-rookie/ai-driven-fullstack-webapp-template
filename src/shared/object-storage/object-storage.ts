import type { IdGenerator, RuntimeEnvironment } from "../runtime";

const OBJECT_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const METADATA_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const SENSITIVE_METADATA_KEY_PATTERN = /(authorization|cookie|password|secret|token|signed[_-]?url)/i;
const MAX_METADATA_VALUE_LENGTH = 1024;

export type ObjectIdentifier = string;
export type ObjectStorageWriteBody =
  | Uint8Array
  | ArrayBuffer
  | ReadableStream<Uint8Array>;

export type ObjectOverwritePolicy = "forbid" | "replace";

export interface ObjectWriteMetadata {
  readonly contentType?: string;
  readonly custom?: Readonly<Record<string, string>>;
}

export interface ObjectDescriptor {
  readonly identifier: ObjectIdentifier;
  readonly byteLength: number;
  readonly etag: string;
  readonly uploadedAt?: Date;
  readonly contentType?: string;
  readonly customMetadata: Readonly<Record<string, string>>;
}

export interface StoredObject extends ObjectDescriptor {
  readonly body: ReadableStream<Uint8Array>;
}

export interface PutObjectInput {
  readonly identifier: ObjectIdentifier;
  readonly body: ObjectStorageWriteBody;
  readonly metadata?: ObjectWriteMetadata;
  readonly overwrite?: ObjectOverwritePolicy;
  readonly ifMatchEtag?: string;
}

export interface ObjectStorage {
  put(input: PutObjectInput): Promise<ObjectDescriptor>;
  get(identifier: ObjectIdentifier): Promise<StoredObject | null>;
  head(identifier: ObjectIdentifier): Promise<ObjectDescriptor | null>;
  delete(identifier: ObjectIdentifier): Promise<void>;
}

export interface TemporaryReadAccess {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface TemporaryObjectAccessProvider {
  createTemporaryReadAccess(input: {
    readonly identifier: ObjectIdentifier;
    readonly expiresAt: Date;
  }): Promise<TemporaryReadAccess>;
}

export type ObjectStorageErrorCode =
  | "invalid_identifier"
  | "invalid_metadata"
  | "already_exists"
  | "precondition_failed"
  | "unsupported"
  | "provider_error";

export class ObjectStorageError extends Error {
  constructor(
    readonly code: ObjectStorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ObjectStorageError";
  }
}

export const assertObjectIdentifier = (
  identifier: string,
): asserts identifier is ObjectIdentifier => {
  if (!OBJECT_IDENTIFIER_PATTERN.test(identifier)) {
    throw new ObjectStorageError(
      "invalid_identifier",
      "Object identifier must be a generated opaque identifier without path separators",
    );
  }
};

export const createObjectIdentifier = (idGenerator: IdGenerator): ObjectIdentifier => {
  const identifier = idGenerator.generate();
  assertObjectIdentifier(identifier);
  return identifier;
};

export const toEnvironmentObjectKey = (
  environment: RuntimeEnvironment,
  identifier: ObjectIdentifier,
): string => {
  assertObjectIdentifier(identifier);
  return `objects/${environment}/${identifier}`;
};

export const normalizeObjectWriteMetadata = (
  metadata?: ObjectWriteMetadata,
): Readonly<{
  contentType?: string;
  custom: Readonly<Record<string, string>>;
}> => {
  const contentType = metadata?.contentType?.trim();
  if (contentType !== undefined && (contentType.length === 0 || contentType.length > 255)) {
    throw new ObjectStorageError(
      "invalid_metadata",
      "Object content type must be between 1 and 255 characters when provided",
    );
  }

  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata?.custom ?? {})) {
    if (!METADATA_KEY_PATTERN.test(key) || SENSITIVE_METADATA_KEY_PATTERN.test(key)) {
      throw new ObjectStorageError(
        "invalid_metadata",
        "Object metadata keys must be bounded, lower-case, and non-sensitive",
      );
    }

    if (value.length > MAX_METADATA_VALUE_LENGTH) {
      throw new ObjectStorageError(
        "invalid_metadata",
        "Object metadata values must be bounded",
      );
    }

    custom[key] = value;
  }

  return Object.freeze({
    ...(contentType === undefined ? {} : { contentType }),
    custom: Object.freeze(custom),
  });
};

export const assertPutPreconditions = (input: PutObjectInput): void => {
  assertObjectIdentifier(input.identifier);
  normalizeObjectWriteMetadata(input.metadata);

  const overwrite = input.overwrite ?? "forbid";
  if (input.ifMatchEtag !== undefined && overwrite !== "replace") {
    throw new ObjectStorageError(
      "precondition_failed",
      "ifMatchEtag can only be used with replace overwrite policy",
    );
  }

  if (input.ifMatchEtag !== undefined && input.ifMatchEtag.trim().length === 0) {
    throw new ObjectStorageError(
      "precondition_failed",
      "ifMatchEtag must not be empty",
    );
  }
};
