export interface MasterDefinition {
  readonly key: string;
  readonly schemaVersion: number;
  readonly supportsHierarchy?: boolean;
  readonly validateCode?: (code: string) => void;
  readonly validateAttributes?: (attributes: unknown) => void;
}

export interface MasterDefinitionResolver {
  resolve(key: string): MasterDefinition | null;
}

export interface MasterItemRecord {
  readonly id: string;
  readonly environment: string;
  readonly masterKey: string;
  readonly code: string;
  readonly version: number;
  readonly nextRevision: number;
  readonly retiredAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface MasterRevisionRecord {
  readonly id: string;
  readonly environment: string;
  readonly masterItemId: string;
  readonly revision: number;
  readonly label: string;
  readonly enabled: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly displayOrder: number;
  readonly parentItemId: string | null;
  readonly attributes: unknown;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface ResolvedMasterValue {
  readonly item: MasterItemRecord;
  readonly revision: MasterRevisionRecord;
}

export interface CreateMasterItemBundle {
  readonly item: MasterItemRecord;
  readonly mutationId: string;
}

export interface AppendMasterRevisionBundle {
  readonly item: MasterItemRecord;
  readonly expectedItemVersion: number;
  readonly mutationId: string;
  readonly revision: MasterRevisionRecord;
}

export interface RetireMasterItemBundle {
  readonly item: MasterItemRecord;
  readonly expectedItemVersion: number;
  readonly mutationId: string;
}

export interface MasterDataStore {
  createItem(bundle: CreateMasterItemBundle): Promise<boolean>;
  getItem(itemId: string, environment: string): Promise<MasterItemRecord | null>;
  getItemByCode(masterKey: string, code: string, environment: string): Promise<MasterItemRecord | null>;
  appendRevision(bundle: AppendMasterRevisionBundle): Promise<boolean>;
  retireItem(bundle: RetireMasterItemBundle): Promise<boolean>;
  resolveAt(
    itemId: string,
    environment: string,
    asOf: string,
    options?: { readonly includeDisabled?: boolean; readonly includeRetired?: boolean },
  ): Promise<ResolvedMasterValue | null>;
  getRevisionById(revisionId: string, environment: string): Promise<ResolvedMasterValue | null>;
  listSelectable(
    masterKey: string,
    environment: string,
    asOf: string,
    limit?: number,
  ): Promise<readonly ResolvedMasterValue[]>;
}

export interface MasterDataMutationGate {
  assertMutationAllowed(): Promise<void> | void;
}

export type MasterDataEventType = "item_created" | "revision_created" | "item_retired";

export interface MasterDataEvent {
  readonly type: MasterDataEventType;
  readonly environment: string;
  readonly masterKey: string;
  readonly itemId: string;
  readonly revisionId?: string;
  readonly actorId: string;
  readonly occurredAt: string;
}

export interface MasterDataEventSink {
  emit(event: MasterDataEvent): Promise<void> | void;
}

export interface CreateMasterItemCommand {
  readonly masterKey: string;
  readonly code: string;
  readonly actorId: string;
}

export interface AddMasterRevisionCommand {
  readonly itemId: string;
  readonly actorId: string;
  readonly expectedItemVersion: number;
  readonly label: string;
  readonly enabled: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly displayOrder?: number;
  readonly parentItemId?: string | null;
  readonly attributes?: unknown;
}

export interface RetireMasterItemCommand {
  readonly itemId: string;
  readonly actorId: string;
  readonly expectedItemVersion: number;
  readonly retiredAt?: string;
}
