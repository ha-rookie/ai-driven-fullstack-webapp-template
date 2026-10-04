import type {
  AddMasterRevisionCommand,
  CreateMasterItemCommand,
  MasterDataEvent,
  MasterDataEventSink,
  MasterDataMutationGate,
  MasterDataStore,
  MasterDefinition,
  MasterDefinitionResolver,
  MasterItemRecord,
  MasterRevisionRecord,
  ResolvedMasterValue,
  RetireMasterItemCommand,
} from "./types";

const MAX_KEY_LENGTH = 128;
const MAX_CODE_LENGTH = 128;
const MAX_LABEL_LENGTH = 256;
const MAX_ACTOR_LENGTH = 256;
const MAX_ATTRIBUTES_JSON_BYTES = 16 * 1024;
const MAX_HIERARCHY_DEPTH = 32;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;

export type MasterDataErrorCode =
  | "invalid_definition"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "retired"
  | "overlapping_revision"
  | "invalid_parent"
  | "hierarchy_cycle";

export class MasterDataError extends Error {
  constructor(public readonly code: MasterDataErrorCode, message: string) {
    super(message);
    this.name = "MasterDataError";
  }
}

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) return true;
  }
  return false;
};

const boundedText = (value: string, name: string, maxLength: number): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || containsControlCharacter(trimmed)) {
    throw new MasterDataError("invalid_input", `${name} is invalid`);
  }
  return trimmed;
};

const assertIsoTimestamp = (value: string, name: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new MasterDataError("invalid_input", `${name} must be an ISO-8601 UTC timestamp`);
  }
  return value;
};

const normalizeDisplayOrder = (value: number | undefined): number => {
  const resolved = value ?? 0;
  if (!Number.isSafeInteger(resolved) || resolved < -1_000_000 || resolved > 1_000_000) {
    throw new MasterDataError("invalid_input", "displayOrder is invalid");
  }
  return resolved;
};

const normalizeJsonValue = (value: unknown): unknown => {
  const seen = new Set<object>();
  const visit = (current: unknown): unknown => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new MasterDataError("invalid_input", "attributes contain a non-finite number");
      return current;
    }
    if (Array.isArray(current)) return current.map(visit);
    if (typeof current === "object") {
      if (seen.has(current)) throw new MasterDataError("invalid_input", "attributes contain a circular reference");
      seen.add(current);
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new MasterDataError("invalid_input", "attributes must contain only plain JSON objects");
      }
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        boundedText(key, "attribute key", MAX_KEY_LENGTH);
        result[key] = visit(child);
      }
      seen.delete(current);
      return result;
    }
    throw new MasterDataError("invalid_input", "attributes must be JSON-compatible");
  };
  const normalized = visit(value ?? {});
  const json = JSON.stringify(normalized);
  if (new TextEncoder().encode(json).byteLength > MAX_ATTRIBUTES_JSON_BYTES) {
    throw new MasterDataError("invalid_input", "attributes are too large");
  }
  return normalized;
};

const validateDefinition = (definition: MasterDefinition): void => {
  boundedText(definition.key, "definition.key", MAX_KEY_LENGTH);
  if (!Number.isSafeInteger(definition.schemaVersion) || definition.schemaVersion <= 0) {
    throw new MasterDataError("invalid_definition", "schemaVersion must be a positive integer");
  }
};

export class StaticMasterDefinitionRegistry implements MasterDefinitionResolver {
  private readonly definitions = new Map<string, MasterDefinition>();

  constructor(definitions: readonly MasterDefinition[]) {
    for (const definition of definitions) {
      validateDefinition(definition);
      if (this.definitions.has(definition.key)) {
        throw new MasterDataError("invalid_definition", `duplicate master definition: ${definition.key}`);
      }
      this.definitions.set(definition.key, definition);
    }
  }

  resolve(key: string): MasterDefinition | null {
    return this.definitions.get(key) ?? null;
  }
}

export interface MasterDataServiceOptions {
  readonly environment: string;
  readonly store: MasterDataStore;
  readonly definitions: MasterDefinitionResolver;
  readonly mutationGate?: MasterDataMutationGate;
  readonly eventSink?: MasterDataEventSink;
  readonly onEventFailure?: (event: MasterDataEvent) => void;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class MasterDataService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: MasterDataServiceOptions) {
    boundedText(options.environment, "environment", MAX_KEY_LENGTH);
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
  }

  private async assertMutationAllowed(): Promise<void> {
    await this.options.mutationGate?.assertMutationAllowed();
  }

  private definition(masterKey: string): MasterDefinition {
    const key = boundedText(masterKey, "masterKey", MAX_KEY_LENGTH);
    const definition = this.options.definitions.resolve(key);
    if (!definition) throw new MasterDataError("invalid_definition", "master definition not found");
    validateDefinition(definition);
    return definition;
  }

  private async emit(event: MasterDataEvent): Promise<void> {
    if (!this.options.eventSink) return;
    try {
      await this.options.eventSink.emit(event);
    } catch {
      this.options.onEventFailure?.(event);
    }
  }

  async createItem(command: CreateMasterItemCommand): Promise<MasterItemRecord> {
    await this.assertMutationAllowed();
    const definition = this.definition(command.masterKey);
    const code = boundedText(command.code, "code", MAX_CODE_LENGTH);
    const actorId = boundedText(command.actorId, "actorId", MAX_ACTOR_LENGTH);
    definition.validateCode?.(code);
    const now = this.now().toISOString();
    const mutationId = this.generateId();
    const item: MasterItemRecord = {
      id: this.generateId(),
      environment: this.options.environment,
      masterKey: definition.key,
      code,
      version: 1,
      nextRevision: 1,
      retiredAt: null,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    };
    if (!await this.options.store.createItem({ item, mutationId })) {
      throw new MasterDataError("conflict", "master item code already exists or conflicted");
    }
    await this.emit({
      type: "item_created",
      environment: this.options.environment,
      masterKey: definition.key,
      itemId: item.id,
      actorId,
      occurredAt: now,
    });
    return item;
  }

  async addRevision(command: AddMasterRevisionCommand): Promise<ResolvedMasterValue> {
    await this.assertMutationAllowed();
    const actorId = boundedText(command.actorId, "actorId", MAX_ACTOR_LENGTH);
    const itemId = boundedText(command.itemId, "itemId", MAX_ACTOR_LENGTH);
    const item = await this.options.store.getItem(itemId, this.options.environment);
    if (!item) throw new MasterDataError("not_found", "master item not found");
    if (item.retiredAt !== null) throw new MasterDataError("retired", "retired master item cannot receive a new revision");
    if (item.version !== command.expectedItemVersion) {
      throw new MasterDataError("conflict", "master item version is stale");
    }
    const definition = this.definition(item.masterKey);
    const effectiveFrom = assertIsoTimestamp(command.effectiveFrom, "effectiveFrom");
    const effectiveTo = command.effectiveTo == null
      ? null
      : assertIsoTimestamp(command.effectiveTo, "effectiveTo");
    if (effectiveTo !== null && effectiveFrom >= effectiveTo) {
      throw new MasterDataError("invalid_input", "effectiveFrom must be before effectiveTo");
    }
    const label = boundedText(command.label, "label", MAX_LABEL_LENGTH);
    const attributes = normalizeJsonValue(command.attributes ?? {});
    definition.validateAttributes?.(attributes);
    const parentItemId = command.parentItemId == null
      ? null
      : boundedText(command.parentItemId, "parentItemId", MAX_ACTOR_LENGTH);
    await this.validateParent(definition, item, parentItemId, effectiveFrom);

    const now = this.now().toISOString();
    const revision: MasterRevisionRecord = {
      id: this.generateId(),
      environment: this.options.environment,
      masterItemId: item.id,
      revision: item.nextRevision,
      label,
      enabled: command.enabled,
      effectiveFrom,
      effectiveTo,
      displayOrder: normalizeDisplayOrder(command.displayOrder),
      parentItemId,
      attributes,
      createdAt: now,
      createdBy: actorId,
    };
    const nextItem: MasterItemRecord = {
      ...item,
      version: item.version + 1,
      nextRevision: item.nextRevision + 1,
      updatedAt: now,
      updatedBy: actorId,
    };
    const mutationId = this.generateId();
    const persisted = await this.options.store.appendRevision({
      item: nextItem,
      expectedItemVersion: command.expectedItemVersion,
      mutationId,
      revision,
    });
    if (!persisted) {
      const latest = await this.options.store.getItem(item.id, this.options.environment);
      if (latest?.version !== command.expectedItemVersion) {
        throw new MasterDataError("conflict", "master item changed concurrently");
      }
      throw new MasterDataError("overlapping_revision", "master revision overlaps an existing effective period");
    }
    await this.emit({
      type: "revision_created",
      environment: this.options.environment,
      masterKey: item.masterKey,
      itemId: item.id,
      revisionId: revision.id,
      actorId,
      occurredAt: now,
    });
    return { item: nextItem, revision };
  }

  async retireItem(command: RetireMasterItemCommand): Promise<MasterItemRecord> {
    await this.assertMutationAllowed();
    const actorId = boundedText(command.actorId, "actorId", MAX_ACTOR_LENGTH);
    const itemId = boundedText(command.itemId, "itemId", MAX_ACTOR_LENGTH);
    const item = await this.options.store.getItem(itemId, this.options.environment);
    if (!item) throw new MasterDataError("not_found", "master item not found");
    if (item.retiredAt !== null) throw new MasterDataError("retired", "master item is already retired");
    if (item.version !== command.expectedItemVersion) {
      throw new MasterDataError("conflict", "master item version is stale");
    }
    const retiredAt = command.retiredAt == null
      ? this.now().toISOString()
      : assertIsoTimestamp(command.retiredAt, "retiredAt");
    const nextItem: MasterItemRecord = {
      ...item,
      version: item.version + 1,
      retiredAt,
      updatedAt: retiredAt,
      updatedBy: actorId,
    };
    const mutationId = this.generateId();
    if (!await this.options.store.retireItem({
      item: nextItem,
      expectedItemVersion: command.expectedItemVersion,
      mutationId,
    })) {
      throw new MasterDataError("conflict", "master item retirement conflicted with a concurrent update");
    }
    await this.emit({
      type: "item_retired",
      environment: this.options.environment,
      masterKey: item.masterKey,
      itemId: item.id,
      actorId,
      occurredAt: retiredAt,
    });
    return nextItem;
  }

  async resolveCurrent(itemId: string, options?: { readonly includeDisabled?: boolean; readonly includeRetired?: boolean }) {
    return this.resolveAsOf(itemId, this.now().toISOString(), options);
  }

  async resolveAsOf(
    itemId: string,
    asOf: string,
    options?: { readonly includeDisabled?: boolean; readonly includeRetired?: boolean },
  ): Promise<ResolvedMasterValue | null> {
    const id = boundedText(itemId, "itemId", MAX_ACTOR_LENGTH);
    const timestamp = assertIsoTimestamp(asOf, "asOf");
    return this.options.store.resolveAt(id, this.options.environment, timestamp, options);
  }

  async resolveHistoricalRevision(revisionId: string): Promise<ResolvedMasterValue | null> {
    return this.options.store.getRevisionById(
      boundedText(revisionId, "revisionId", MAX_ACTOR_LENGTH),
      this.options.environment,
    );
  }

  async listSelectable(masterKey: string, options?: { readonly asOf?: string; readonly limit?: number }) {
    const definition = this.definition(masterKey);
    const asOf = options?.asOf == null ? this.now().toISOString() : assertIsoTimestamp(options.asOf, "asOf");
    const limit = options?.limit ?? DEFAULT_LIST_LIMIT;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_LIST_LIMIT) {
      throw new MasterDataError("invalid_input", `limit must be between 1 and ${MAX_LIST_LIMIT}`);
    }
    return this.options.store.listSelectable(definition.key, this.options.environment, asOf, limit);
  }

  private async validateParent(
    definition: MasterDefinition,
    item: MasterItemRecord,
    parentItemId: string | null,
    asOf: string,
  ): Promise<void> {
    if (parentItemId === null) return;
    if (definition.supportsHierarchy !== true) {
      throw new MasterDataError("invalid_parent", "this master does not support hierarchy");
    }
    if (parentItemId === item.id) throw new MasterDataError("hierarchy_cycle", "master item cannot parent itself");

    let currentId: string | null = parentItemId;
    const visited = new Set<string>([item.id]);
    for (let depth = 0; currentId !== null && depth < MAX_HIERARCHY_DEPTH; depth += 1) {
      if (visited.has(currentId)) throw new MasterDataError("hierarchy_cycle", "master hierarchy contains a cycle");
      visited.add(currentId);
      const currentItem = await this.options.store.getItem(currentId, this.options.environment);
      if (!currentItem || currentItem.masterKey !== item.masterKey) {
        throw new MasterDataError("invalid_parent", "parent must belong to the same master");
      }
      const resolved = await this.options.store.resolveAt(currentId, this.options.environment, asOf, {
        includeDisabled: false,
        includeRetired: false,
      });
      if (!resolved) throw new MasterDataError("invalid_parent", "parent must be selectable at effectiveFrom");
      currentId = resolved.revision.parentItemId;
    }
    if (currentId !== null) {
      throw new MasterDataError("hierarchy_cycle", "master hierarchy exceeds the supported depth");
    }
  }
}
