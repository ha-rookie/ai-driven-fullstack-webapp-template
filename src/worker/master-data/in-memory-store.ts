import type {
  AppendMasterRevisionBundle,
  CreateMasterItemBundle,
  MasterDataStore,
  MasterItemRecord,
  MasterRevisionRecord,
  ResolvedMasterValue,
  RetireMasterItemBundle,
} from "./types";

const overlaps = (
  leftFrom: string,
  leftTo: string | null,
  rightFrom: string,
  rightTo: string | null,
): boolean => (leftTo === null || rightFrom < leftTo) && (rightTo === null || leftFrom < rightTo);

export class InMemoryMasterDataStore implements MasterDataStore {
  private readonly items = new Map<string, MasterItemRecord>();
  private readonly revisions = new Map<string, MasterRevisionRecord>();

  async createItem(bundle: CreateMasterItemBundle): Promise<boolean> {
    const duplicate = [...this.items.values()].some((item) =>
      item.environment === bundle.item.environment
      && item.masterKey === bundle.item.masterKey
      && item.code === bundle.item.code,
    );
    if (duplicate || this.items.has(bundle.item.id)) return false;
    this.items.set(bundle.item.id, bundle.item);
    return true;
  }

  async getItem(itemId: string, environment: string): Promise<MasterItemRecord | null> {
    const item = this.items.get(itemId);
    return item?.environment === environment ? item : null;
  }

  async getItemByCode(masterKey: string, code: string, environment: string): Promise<MasterItemRecord | null> {
    return [...this.items.values()].find((item) =>
      item.environment === environment && item.masterKey === masterKey && item.code === code,
    ) ?? null;
  }

  async appendRevision(bundle: AppendMasterRevisionBundle): Promise<boolean> {
    const current = this.items.get(bundle.item.id);
    if (!current || current.environment !== bundle.item.environment) return false;
    if (current.version !== bundle.expectedItemVersion || current.retiredAt !== null) return false;
    const hasOverlap = [...this.revisions.values()].some((revision) =>
      revision.masterItemId === bundle.item.id
      && revision.environment === bundle.item.environment
      && overlaps(
        revision.effectiveFrom,
        revision.effectiveTo,
        bundle.revision.effectiveFrom,
        bundle.revision.effectiveTo,
      ),
    );
    if (hasOverlap || this.revisions.has(bundle.revision.id)) return false;
    this.items.set(bundle.item.id, bundle.item);
    this.revisions.set(bundle.revision.id, bundle.revision);
    return true;
  }

  async retireItem(bundle: RetireMasterItemBundle): Promise<boolean> {
    const current = this.items.get(bundle.item.id);
    if (!current || current.environment !== bundle.item.environment) return false;
    if (current.version !== bundle.expectedItemVersion || current.retiredAt !== null) return false;
    this.items.set(bundle.item.id, bundle.item);
    return true;
  }

  async resolveAt(
    itemId: string,
    environment: string,
    asOf: string,
    options: { readonly includeDisabled?: boolean; readonly includeRetired?: boolean } = {},
  ): Promise<ResolvedMasterValue | null> {
    const item = await this.getItem(itemId, environment);
    if (!item) return null;
    if (options.includeRetired !== true && item.retiredAt !== null && item.retiredAt <= asOf) return null;
    const revision = [...this.revisions.values()]
      .filter((candidate) => candidate.environment === environment
        && candidate.masterItemId === itemId
        && candidate.effectiveFrom <= asOf
        && (candidate.effectiveTo === null || asOf < candidate.effectiveTo))
      .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
    if (!revision) return null;
    if (options.includeDisabled !== true && !revision.enabled) return null;
    return { item, revision };
  }

  async getRevisionById(revisionId: string, environment: string): Promise<ResolvedMasterValue | null> {
    const revision = this.revisions.get(revisionId);
    if (!revision || revision.environment !== environment) return null;
    const item = await this.getItem(revision.masterItemId, environment);
    return item ? { item, revision } : null;
  }

  async listSelectable(
    masterKey: string,
    environment: string,
    asOf: string,
    limit = 100,
  ): Promise<readonly ResolvedMasterValue[]> {
    const values: ResolvedMasterValue[] = [];
    for (const item of this.items.values()) {
      if (item.environment !== environment || item.masterKey !== masterKey) continue;
      const resolved = await this.resolveAt(item.id, environment, asOf);
      if (resolved) values.push(resolved);
    }
    return values
      .sort((left, right) => left.revision.displayOrder - right.revision.displayOrder
        || left.revision.label.localeCompare(right.revision.label)
        || left.item.id.localeCompare(right.item.id))
      .slice(0, limit);
  }
}
