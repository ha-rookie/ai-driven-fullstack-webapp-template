export const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;

export type RequestBodyFailureCode =
  | "unsupported_media_type"
  | "payload_too_large"
  | "malformed_json";

export type RequestBodyFailure = {
  readonly ok: false;
  readonly status: 400 | 413 | 415;
  readonly code: RequestBodyFailureCode;
  readonly message: string;
};

export type JsonBodyResult =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly bytesRead: number;
    }
  | RequestBodyFailure;

export interface ReadJsonBodyOptions {
  readonly maxBytes?: number;
}

const unsupportedMediaType = (): RequestBodyFailure => ({
  ok: false,
  status: 415,
  code: "unsupported_media_type",
  message: "Content-Type must be application/json",
});

const payloadTooLarge = (): RequestBodyFailure => ({
  ok: false,
  status: 413,
  code: "payload_too_large",
  message: "Request body exceeds the allowed size",
});

const malformedJson = (): RequestBodyFailure => ({
  ok: false,
  status: 400,
  code: "malformed_json",
  message: "Request body must contain valid JSON",
});

const mediaType = (contentType: string | null): string | null => {
  if (!contentType) return null;
  const [type] = contentType.split(";", 1);
  const normalized = type.trim().toLowerCase();
  return normalized || null;
};

const declaredBodyLength = (request: Request): number | null => {
  const value = request.headers.get("content-length");
  if (value === null) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const readBodyBytes = async (
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | RequestBodyFailure> => {
  if (!request.body) {
    return { ok: true, bytes: new Uint8Array() };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel("request_body_too_large");
        } catch {
          // The response contract is still 413 even if stream cancellation fails.
        }
        return payloadTooLarge();
      }

      chunks.push(value);
    }
  } catch {
    return malformedJson();
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, bytes };
};

export const readJsonBody = async (
  request: Request,
  options: ReadJsonBodyOptions = {},
): Promise<JsonBodyResult> => {
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("request_body_guard_invalid_max_bytes");
  }

  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    return unsupportedMediaType();
  }

  const declaredLength = declaredBodyLength(request);
  if (declaredLength !== null && declaredLength > maxBytes) {
    return payloadTooLarge();
  }

  const bodyResult = await readBodyBytes(request, maxBytes);
  if (!bodyResult.ok) return bodyResult;

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bodyResult.bytes);
  } catch {
    return malformedJson();
  }

  try {
    return {
      ok: true,
      value: JSON.parse(text) as unknown,
      bytesRead: bodyResult.bytes.byteLength,
    };
  } catch {
    return malformedJson();
  }
};
