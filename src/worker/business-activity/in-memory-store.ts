import type {
  BusinessActivityCursor,
  BusinessActivityRecord,
  BusinessActivityStore,
  BusinessActivityStoreListQuery,
  BusinessActivityStorePage,
} from "./types";

const sourceKey = (record: Pick<BusinessActivityRecord, "environment" | "sourceType" | "sourceId">) =>
  `${record.environment}:${record.sourceType}:${record.sourceId}`;

const isBeforeCursor = (record: BusinessActivityRecord, cursor: BusinessActivityCursor): boolean => {
  if (record.occurredAt !== cursor.occurredAt) return record.occurredAt < cursor.occurredAt;
  if (record.sequence !== cursor.sequence) return record.sequence < cursor.sequence;
  return record.id < cursor.id;
};

const compareDescending = (left: BusinessActivityRecord, right: BusinessActivityRecord): number => {
  if (left.occurredAt !== right.occurredAt) return right.occurredAt.localeCompare(left.occurredAt);
  if (left.sequence !== right.sequence) return right.sequence - left.sequence;
  return right.id.localeCompare(left.id);
};

export class InMemoryBusinessActivityStore implements BusinessActivityStore {
  private readonly byId = new Map<string, BusinessActivityRecord>();
  private readonly sourceKeys = new Set<string>();

  async append(record: BusinessActivityRecord): Promise<"created" | "duplicate"> {
    const uniqueSource = sourceKey(record);
    if (this.sourceKeys.has(uniqueSource)) return "duplicate";
    this.byId.set(`${record.environment}:${record.id}`, structuredClone(record));
    this.sourceKeys.add(uniqueSource);
    return "created";
  }

  async list(query: BusinessActivityStoreListQuery): Promise<BusinessActivityStorePage> {
    const candidates = [...this.byId.values()]
      .filter((record) =>
        record.environment === query.environment
        && record.resourceType === query.resourceType
        && record.resourceId === query.resourceId
        && (!query.activityTypes?.length || query.activityTypes.includes(record.activityType))
        && (!query.cursor || isBeforeCursor(record, query.cursor)))
      .sort(compareDescending);

    const window = candidates.slice(0, query.limit + 1);
    const hasMore = window.length > query.limit;
    const items = window.slice(0, query.limit).map((record) => structuredClone(record));
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? { occurredAt: last.occurredAt, sequence: last.sequence, id: last.id }
        : null,
    };
  }
}
