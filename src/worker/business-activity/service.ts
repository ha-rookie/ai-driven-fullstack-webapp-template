import type {
  BusinessActivityCursor,
  BusinessActivityMetadata,
  BusinessActivityMetadataValue,
  BusinessActivityProjectionResult,
  BusinessActivityRecord,
  BusinessActivityResourceAuthorizer,
  BusinessActivityStore,
  BusinessActivityTimelinePage,
  BusinessActivityTimelineQuery,
  BusinessActivityVisibilityPolicy,
  ProjectBusinessActivityInput,
} from "./types";

const MAX_KEY_LENGTH = 128;
const MAX_ID_LENGTH = 256;
const MAX_DISPLAY_LENGTH = 256;
const MAX_METADATA_KEYS = 24;
const MAX_METADATA_JSON_LENGTH = 4_096;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export type BusinessActivityErrorCode =
  | "invalid_input"
  | "invalid_cursor"
  | "forbidden";

export class BusinessActivityError extends Error {
  constructor(public readonly code: BusinessActivityErrorCode, message: string) {
    super(message);
    this.name = "BusinessActivityError";
  }
}

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) return true;
  }
  return false;
};

const boundedText = (value: string, name: string, maxLength: number): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || hasControlCharacter(normalized)) {
    throw new BusinessActivityError("invalid_input", `${name} is invalid`);
  }
  return normalized;
};

const optionalText = (
  value: string | null | undefined,
  name: string,
  maxLength: number,
): string | null => value === null || value === undefined
  ? null
  : boundedText(value, name, maxLength);

const positiveOrZeroInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BusinessActivityError("invalid_input", `${name} must be a non-negative safe integer`);
  }
  return value;
};

const isoTimestamp = (value: string, name: string): string => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new BusinessActivityError("invalid_input", `${name} must be a canonical ISO timestamp`);
  }
  return value;
};

const validateMetadataValue = (value: BusinessActivityMetadataValue): void => {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new BusinessActivityError("invalid_input", "metadata numbers must be finite");
  }
};

const boundedMetadata = (metadata: BusinessActivityMetadata | undefined): BusinessActivityMetadata => {
  if (!metadata) return {};
  const entries = Object.entries(metadata);
  if (entries.length > MAX_METADATA_KEYS) {
    throw new BusinessActivityError("invalid_input", "metadata has too many keys");
  }
  const result: Record<string, BusinessActivityMetadataValue> = {};
  for (const [key, value] of entries) {
    const normalizedKey = boundedText(key, "metadata key", MAX_KEY_LENGTH);
    validateMetadataValue(value);
    if (typeof value === "string" && value.length > MAX_METADATA_JSON_LENGTH) {
      throw new BusinessActivityError("invalid_input", "metadata string is too large");
    }
    result[normalizedKey] = value;
  }
  if (JSON.stringify(result).length > MAX_METADATA_JSON_LENGTH) {
    throw new BusinessActivityError("invalid_input", "metadata is too large");
  }
  return result;
};

const bytesToBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const base64UrlToText = (value: string): string => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const encodeBusinessActivityCursor = (cursor: BusinessActivityCursor): string =>
  bytesToBase64Url(JSON.stringify({
    v: 1,
    occurredAt: cursor.occurredAt,
    sequence: cursor.sequence,
    id: cursor.id,
  }));

export const decodeBusinessActivityCursor = (value: string): BusinessActivityCursor => {
  try {
    const decoded = JSON.parse(base64UrlToText(value)) as {
      v?: unknown;
      occurredAt?: unknown;
      sequence?: unknown;
      id?: unknown;
    };
    if (decoded.v !== 1 || typeof decoded.occurredAt !== "string" || typeof decoded.id !== "string") {
      throw new Error("invalid cursor shape");
    }
    return {
      occurredAt: isoTimestamp(decoded.occurredAt, "cursor.occurredAt"),
      sequence: positiveOrZeroInteger(decoded.sequence as number, "cursor.sequence"),
      id: boundedText(decoded.id, "cursor.id", MAX_ID_LENGTH),
    };
  } catch (error) {
    if (error instanceof BusinessActivityError) {
      throw new BusinessActivityError("invalid_cursor", "timeline cursor is invalid");
    }
    throw new BusinessActivityError("invalid_cursor", "timeline cursor is invalid");
  }
};

export interface BusinessActivityProjectorOptions {
  readonly environment: string;
  readonly store: BusinessActivityStore;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class BusinessActivityProjector {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: BusinessActivityProjectorOptions) {
    boundedText(options.environment, "environment", MAX_KEY_LENGTH);
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
  }

  async project(input: ProjectBusinessActivityInput): Promise<BusinessActivityProjectionResult> {
    const createdAt = this.now().toISOString();
    const record: BusinessActivityRecord = {
      id: boundedText(this.generateId(), "id", MAX_ID_LENGTH),
      environment: this.options.environment,
      resourceType: boundedText(input.resourceType, "resourceType", MAX_KEY_LENGTH),
      resourceId: boundedText(input.resourceId, "resourceId", MAX_ID_LENGTH),
      activityType: boundedText(input.activityType, "activityType", MAX_KEY_LENGTH),
      actorRef: optionalText(input.actorRef, "actorRef", MAX_ID_LENGTH),
      actorDisplaySnapshot: optionalText(
        input.actorDisplaySnapshot,
        "actorDisplaySnapshot",
        MAX_DISPLAY_LENGTH,
      ),
      subjectRef: optionalText(input.subjectRef, "subjectRef", MAX_ID_LENGTH),
      sourceType: boundedText(input.sourceType, "sourceType", MAX_KEY_LENGTH),
      sourceId: boundedText(input.sourceId, "sourceId", MAX_ID_LENGTH),
      sequence: positiveOrZeroInteger(input.sequence ?? 0, "sequence"),
      visibilityScope: optionalText(input.visibilityScope, "visibilityScope", MAX_KEY_LENGTH),
      metadata: boundedMetadata(input.metadata),
      occurredAt: isoTimestamp(input.occurredAt, "occurredAt"),
      createdAt,
    };
    const outcome = await this.options.store.append(record);
    return { record, created: outcome === "created" };
  }
}

export interface BusinessActivityTimelineServiceOptions {
  readonly environment: string;
  readonly store: BusinessActivityStore;
  readonly authorizer: BusinessActivityResourceAuthorizer;
  readonly visibilityPolicy?: BusinessActivityVisibilityPolicy;
}

export class BusinessActivityTimelineService {
  constructor(private readonly options: BusinessActivityTimelineServiceOptions) {
    boundedText(options.environment, "environment", MAX_KEY_LENGTH);
  }

  async list(query: BusinessActivityTimelineQuery): Promise<BusinessActivityTimelinePage> {
    const context = {
      principalId: boundedText(query.principalId, "principalId", MAX_ID_LENGTH),
      environment: this.options.environment,
      resourceType: boundedText(query.resourceType, "resourceType", MAX_KEY_LENGTH),
      resourceId: boundedText(query.resourceId, "resourceId", MAX_ID_LENGTH),
    };
    try {
      await this.options.authorizer.assertCanRead(context);
    } catch {
      throw new BusinessActivityError("forbidden", "timeline access is not allowed");
    }

    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_PAGE_SIZE) {
      throw new BusinessActivityError("invalid_input", `limit must be between 1 and ${MAX_PAGE_SIZE}`);
    }
    const activityTypes = query.activityTypes?.map((value) =>
      boundedText(value, "activityType", MAX_KEY_LENGTH));
    if (activityTypes && activityTypes.length > 20) {
      throw new BusinessActivityError("invalid_input", "too many activityType filters");
    }

    const page = await this.options.store.list({
      environment: this.options.environment,
      resourceType: context.resourceType,
      resourceId: context.resourceId,
      limit,
      cursor: query.cursor ? decodeBusinessActivityCursor(query.cursor) : undefined,
      activityTypes,
    });

    const visible: BusinessActivityRecord[] = [];
    for (const item of page.items) {
      const transformed = this.options.visibilityPolicy
        ? await this.options.visibilityPolicy.apply(item, context)
        : item;
      if (transformed) visible.push(transformed);
    }

    return {
      items: visible,
      nextCursor: page.nextCursor ? encodeBusinessActivityCursor(page.nextCursor) : null,
    };
  }
}
