import { apiErrorResponse } from "./api-error";
import {
  ObjectStorageError,
  createObjectIdentifier,
  type ObjectIdentifier,
  type ObjectStorage,
} from "../../shared/object-storage";
import type { IdGenerator } from "../../shared/runtime";

const DEFAULT_MAX_FILENAME_LENGTH = 180;
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+*-]+$/;
const UNSAFE_FILENAME_PATTERN = /[\/\\\u0000-\u001f\u007f]/u;

export interface FileTransferPolicy {
  readonly maxRequestBytes: number;
  readonly maxFileBytes: number;
  readonly maxFileCount: number;
  readonly allowedMediaTypes: readonly string[];
  readonly maxFilenameLength?: number;
}

export type FileTransferFailure = {
  readonly ok: false;
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 503;
  readonly code:
    | "authentication_required"
    | "forbidden"
    | "resource_not_found"
    | "unsupported_media_type"
    | "payload_too_large"
    | "malformed_multipart"
    | "invalid_filename"
    | "empty_file"
    | "too_many_files"
    | "storage_conflict"
    | "storage_unavailable";
  readonly message: string;
};

export type FileTransferAccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly status: 401 | 403;
      readonly code: "authentication_required" | "forbidden";
      readonly message: string;
    };

export interface ParsedUploadFile {
  readonly displayFilename: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly body: ReadableStream<Uint8Array>;
}

export type MultipartUploadResult =
  | {
      readonly ok: true;
      readonly files: readonly ParsedUploadFile[];
      readonly requestBytesRead: number;
    }
  | FileTransferFailure;

export interface StoredUploadFile {
  readonly identifier: ObjectIdentifier;
  readonly displayFilename: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly etag: string;
}

export type StoreUploadResult =
  | { readonly ok: true; readonly files: readonly StoredUploadFile[] }
  | FileTransferFailure;

export type FileDownloadResolution =
  | {
      readonly kind: "authorized";
      readonly identifier: ObjectIdentifier;
      readonly displayFilename: string;
      readonly contentType?: string;
      readonly disposition?: "attachment" | "inline";
    }
  | { readonly kind: "authentication_required" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" };

export interface AuthorizedDownloadOptions {
  readonly request: Request;
  readonly requestId: string;
  readonly storage: ObjectStorage;
  readonly resolve: (request: Request) => Promise<FileDownloadResolution>;
  readonly hideForbiddenAsNotFound?: boolean;
}

const failure = (
  status: FileTransferFailure["status"],
  code: FileTransferFailure["code"],
  message: string,
): FileTransferFailure => ({ ok: false, status, code, message });

const normalizeMediaType = (value: string): string | null => {
  const [raw] = value.split(";", 1);
  const normalized = raw.trim().toLowerCase();
  return MEDIA_TYPE_PATTERN.test(normalized) ? normalized : null;
};

const assertPolicy = (policy: FileTransferPolicy): void => {
  for (const [name, value] of [
    ["maxRequestBytes", policy.maxRequestBytes],
    ["maxFileBytes", policy.maxFileBytes],
    ["maxFileCount", policy.maxFileCount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }

  const maxFilenameLength = policy.maxFilenameLength ?? DEFAULT_MAX_FILENAME_LENGTH;
  if (!Number.isSafeInteger(maxFilenameLength) || maxFilenameLength < 1 || maxFilenameLength > 255) {
    throw new TypeError("maxFilenameLength must be between 1 and 255");
  }

  if (policy.allowedMediaTypes.length === 0) {
    throw new TypeError("allowedMediaTypes must not be empty");
  }

  for (const mediaType of policy.allowedMediaTypes) {
    const normalized = normalizeMediaType(mediaType);
    if (normalized === null) throw new TypeError("allowedMediaTypes contains an invalid media type");
    const [type, subtype] = normalized.split("/", 2);
    if (type === "*" || (subtype.includes("*") && subtype !== "*")) {
      throw new TypeError("allowedMediaTypes supports only exact values or type/* wildcards");
    }
  }
};

const isAllowedMediaType = (mediaType: string, allowed: readonly string[]): boolean => {
  const normalized = normalizeMediaType(mediaType);
  if (normalized === null || normalized.includes("*")) return false;
  const [type] = normalized.split("/", 1);
  return allowed.some((candidate) => {
    const normalizedCandidate = normalizeMediaType(candidate);
    if (normalizedCandidate === null) return false;
    return normalizedCandidate === normalized || normalizedCandidate === `${type}/*`;
  });
};

export const normalizeDisplayFilename = (
  value: string,
  maxLength = DEFAULT_MAX_FILENAME_LENGTH,
): string | null => {
  const normalized = value.normalize("NFKC").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    normalized === "." ||
    normalized === ".." ||
    UNSAFE_FILENAME_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
};

const asciiFilenameFallback = (filename: string): string => {
  const fallback = filename
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 120);
  return fallback || "download";
};

const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const createContentDisposition = (
  filename: string,
  disposition: "attachment" | "inline" = "attachment",
): string => {
  const safe = normalizeDisplayFilename(filename) ?? "download";
  return `${disposition}; filename="${asciiFilenameFallback(safe)}"; filename*=UTF-8''${encodeRfc5987(safe)}`;
};

const declaredLength = (request: Request): number | null => {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const isMultipartFormData = (contentType: string | null): boolean => {
  if (!contentType) return false;
  const [rawType] = contentType.split(";", 1);
  const hasBoundary = /(?:^|;)\s*boundary=(?:"[^"]+"|[^;\s]+)/i.test(contentType);
  return rawType.trim().toLowerCase() === "multipart/form-data" && hasBoundary;
};

const parseMultipartForm = async (
  request: Request,
  maxRequestBytes: number,
): Promise<{ ok: true; form: FormData; bytesRead: number } | FileTransferFailure> => {
  const contentType = request.headers.get("content-type");
  if (!isMultipartFormData(contentType)) {
    return failure(415, "unsupported_media_type", "Content-Type must be multipart/form-data with a boundary");
  }

  const length = declaredLength(request);
  if (length !== null && length > maxRequestBytes) {
    return failure(413, "payload_too_large", "Upload request exceeds the allowed size");
  }

  if (!request.body) {
    return failure(400, "malformed_multipart", "Multipart request body is missing");
  }

  const reader = request.body.getReader();
  let bytesRead = 0;
  let exceeded = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } catch {
      // Best effort. The parser response remains authoritative.
    }
  };

  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
          return;
        }

        if (!value || value.byteLength === 0) return;
        bytesRead += value.byteLength;
        if (bytesRead > maxRequestBytes) {
          exceeded = true;
          try {
            await reader.cancel("file_transfer_request_too_large");
          } catch {
            // The HTTP result is still 413 even if cancellation fails.
          }
          release();
          controller.error(new Error("file_transfer_request_too_large"));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    },
  });

  try {
    const form = await new Response(boundedBody, {
      headers: { "content-type": contentType ?? "" },
    }).formData();
    return { ok: true, form, bytesRead };
  } catch {
    return exceeded
      ? failure(413, "payload_too_large", "Upload request exceeds the allowed size")
      : failure(400, "malformed_multipart", "Multipart request could not be parsed");
  } finally {
    release();
  }
};

export const readMultipartUpload = async (
  request: Request,
  policy: FileTransferPolicy,
): Promise<MultipartUploadResult> => {
  assertPolicy(policy);
  const parsed = await parseMultipartForm(request, policy.maxRequestBytes);
  if (!parsed.ok) return parsed;

  const entries: Array<string | File> = [];
  parsed.form.forEach((entry) => {
    entries.push(entry);
  });
  if (entries.some((entry) => typeof entry === "string")) {
    return failure(400, "malformed_multipart", "Only file parts are accepted by the shared upload boundary");
  }

  const files = entries as File[];
  if (files.length === 0) {
    return failure(400, "malformed_multipart", "At least one file part is required");
  }
  if (files.length > policy.maxFileCount) {
    return failure(413, "too_many_files", "Upload contains more files than allowed");
  }

  const maxFilenameLength = policy.maxFilenameLength ?? DEFAULT_MAX_FILENAME_LENGTH;
  const validated: ParsedUploadFile[] = [];
  for (const file of files) {
    if (file.size === 0) {
      return failure(400, "empty_file", "Empty files are not accepted");
    }
    if (file.size > policy.maxFileBytes) {
      return failure(413, "payload_too_large", "A file exceeds the allowed size");
    }

    const filename = normalizeDisplayFilename(file.name, maxFilenameLength);
    if (filename === null) {
      return failure(400, "invalid_filename", "Filename contains unsafe characters or exceeds the allowed length");
    }

    const mediaType = normalizeMediaType(file.type);
    if (mediaType === null || !isAllowedMediaType(mediaType, policy.allowedMediaTypes)) {
      return failure(415, "unsupported_media_type", "File media type is not allowed");
    }

    validated.push({
      displayFilename: filename,
      mediaType,
      byteLength: file.size,
      body: file.stream(),
    });
  }

  return { ok: true, files: Object.freeze(validated), requestBytesRead: parsed.bytesRead };
};

export const readAuthorizedMultipartUpload = async (
  request: Request,
  policy: FileTransferPolicy,
  authorize: (request: Request) => Promise<FileTransferAccessDecision>,
): Promise<MultipartUploadResult> => {
  const access = await authorize(request);
  if (!access.allowed) {
    return failure(access.status, access.code, access.message);
  }
  return readMultipartUpload(request, policy);
};

const mapStorageError = (error: unknown): FileTransferFailure => {
  if (error instanceof ObjectStorageError) {
    if (error.code === "already_exists" || error.code === "precondition_failed") {
      return failure(409, "storage_conflict", "File storage conflict");
    }
  }
  return failure(503, "storage_unavailable", "File storage is unavailable");
};

export const storeParsedUploadFiles = async (
  files: readonly ParsedUploadFile[],
  storage: ObjectStorage,
  idGenerator: IdGenerator,
): Promise<StoreUploadResult> => {
  const stored: StoredUploadFile[] = [];
  try {
    for (const file of files) {
      const identifier = createObjectIdentifier(idGenerator);
      const descriptor = await storage.put({
        identifier,
        body: file.body,
        metadata: { contentType: file.mediaType },
      });
      stored.push({
        identifier,
        displayFilename: file.displayFilename,
        mediaType: file.mediaType,
        byteLength: descriptor.byteLength,
        etag: descriptor.etag,
      });
    }
    return { ok: true, files: Object.freeze(stored) };
  } catch (error) {
    for (const item of stored) {
      try {
        await storage.delete(item.identifier);
      } catch {
        // A later orphan cleanup policy remains necessary if compensation fails.
      }
    }
    return mapStorageError(error);
  }
};

export const fileTransferFailureResponse = (
  transferFailure: FileTransferFailure,
  requestId: string,
): Response =>
  apiErrorResponse(
    {
      status: transferFailure.status,
      code: transferFailure.code,
      message: transferFailure.message,
    },
    requestId,
  );

const normalizeDownloadContentType = (value: string | undefined): string =>
  value === undefined ? "application/octet-stream" : (normalizeMediaType(value) ?? "application/octet-stream");

export const createAuthorizedDownloadResponse = async ({
  request,
  requestId,
  storage,
  resolve,
  hideForbiddenAsNotFound = false,
}: AuthorizedDownloadOptions): Promise<Response> => {
  const resolution = await resolve(request);
  if (resolution.kind === "authentication_required") {
    return fileTransferFailureResponse(
      failure(401, "authentication_required", "Authentication required"),
      requestId,
    );
  }
  if (resolution.kind === "forbidden") {
    return fileTransferFailureResponse(
      hideForbiddenAsNotFound
        ? failure(404, "resource_not_found", "Resource not found")
        : failure(403, "forbidden", "Access denied"),
      requestId,
    );
  }
  if (resolution.kind === "not_found") {
    return fileTransferFailureResponse(
      failure(404, "resource_not_found", "Resource not found"),
      requestId,
    );
  }

  let stored;
  try {
    stored = await storage.get(resolution.identifier);
  } catch (error) {
    return fileTransferFailureResponse(mapStorageError(error), requestId);
  }
  if (stored === null) {
    return fileTransferFailureResponse(
      failure(404, "resource_not_found", "Resource not found"),
      requestId,
    );
  }

  const filename = normalizeDisplayFilename(resolution.displayFilename) ?? "download";
  const contentType = normalizeDownloadContentType(resolution.contentType ?? stored.contentType);
  return new Response(stored.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(stored.byteLength),
      "content-disposition": createContentDisposition(filename, resolution.disposition ?? "attachment"),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
};
