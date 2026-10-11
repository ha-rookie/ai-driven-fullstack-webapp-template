import type {
  TravelRequestCompareAndSetOptions,
  TravelRequestRecord,
  TravelRequestStore,
} from "./types";

const keyOf = (environment: string, id: string): string => `${environment}:${id}`;

export class InMemoryTravelRequestStore implements TravelRequestStore {
  private readonly records = new Map<string, TravelRequestRecord>();

  async create(record: TravelRequestRecord): Promise<boolean> {
    const key = keyOf(record.environment, record.id);
    if (this.records.has(key)) return false;
    this.records.set(key, { ...record });
    return true;
  }

  async get(id: string, environment: string): Promise<TravelRequestRecord | null> {
    const record = this.records.get(keyOf(environment, id));
    return record ? { ...record } : null;
  }

  async listOwned(environment: string, requesterId: string, limit: number): Promise<readonly TravelRequestRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.environment === environment && record.requesterId === requesterId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async compareAndSet(
    record: TravelRequestRecord,
    options: TravelRequestCompareAndSetOptions,
  ): Promise<boolean> {
    const key = keyOf(record.environment, record.id);
    const current = this.records.get(key);
    if (!current) return false;
    if (current.version !== options.expectedVersion || current.status !== options.expectedStatus) {
      return false;
    }
    this.records.set(key, { ...record });
    return true;
  }
}
