import type { TransactionalNotificationRecord, TransactionalNotificationStore } from "./types";

export class InMemoryTransactionalNotificationStore implements TransactionalNotificationStore {
  private readonly records = new Map<string, TransactionalNotificationRecord>();
  private readonly dedupe = new Set<string>();

  async create(record: TransactionalNotificationRecord): Promise<"created" | "duplicate"> {
    const key = `${record.environment}:${record.dedupeKey}`;
    if (this.dedupe.has(key)) return "duplicate";
    this.records.set(`${record.environment}:${record.id}`, structuredClone(record));
    this.dedupe.add(key);
    return "created";
  }

  async get(id: string, environment: string) {
    return structuredClone(this.records.get(`${environment}:${id}`) ?? null);
  }

  async listForRecipient(query: Parameters<TransactionalNotificationStore["listForRecipient"]>[0]) {
    return [...this.records.values()]
      .filter((record) => record.environment === query.environment
        && record.recipientPrincipal === query.recipientPrincipal
        && !record.archivedAt
        && (!query.unreadOnly || !record.readAt)
        && (!query.category || record.category === query.category))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, query.limit)
      .map((record) => structuredClone(record));
  }

  async markRead(input: Parameters<TransactionalNotificationStore["markRead"]>[0]) {
    const key = `${input.environment}:${input.id}`;
    const record = this.records.get(key);
    if (!record || record.recipientPrincipal !== input.recipientPrincipal || record.version !== input.expectedVersion) return false;
    if (record.readAt) return true;
    this.records.set(key, { ...record, readAt: input.readAt, version: record.version + 1 });
    return true;
  }

  async archive(input: Parameters<TransactionalNotificationStore["archive"]>[0]) {
    const key = `${input.environment}:${input.id}`;
    const record = this.records.get(key);
    if (!record || record.recipientPrincipal !== input.recipientPrincipal || record.version !== input.expectedVersion) return false;
    if (record.archivedAt) return true;
    this.records.set(key, { ...record, archivedAt: input.archivedAt, version: record.version + 1 });
    return true;
  }

  async countUnread(environment: string, recipientPrincipal: string) {
    return [...this.records.values()].filter((record) => record.environment === environment && record.recipientPrincipal === recipientPrincipal && !record.readAt && !record.archivedAt).length;
  }
}
