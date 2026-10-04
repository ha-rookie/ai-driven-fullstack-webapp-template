import type { IntegrationEventRecord, IntegrationEventStore, OutboxRecord } from "./types";

const eventKey = (environment: string, id: string) => `${environment}\u0000${id}`;
const outboxKey = (environment: string, id: string) => `${environment}\u0000${id}`;
const destinationKey = (record: OutboxRecord) =>
  `${record.environment}\u0000${record.integrationEventId}\u0000${record.destinationKey}`;

export class InMemoryIntegrationEventStore implements IntegrationEventStore {
  private readonly events = new Map<string, IntegrationEventRecord>();
  private readonly outbox = new Map<string, OutboxRecord>();
  private readonly destinations = new Set<string>();

  async createEventWithOutbox(input: { readonly event: IntegrationEventRecord; readonly outbox: OutboxRecord }) {
    const eventId = eventKey(input.event.environment, input.event.id);
    const outboxId = outboxKey(input.outbox.environment, input.outbox.id);
    const target = destinationKey(input.outbox);
    if (this.events.has(eventId) || this.outbox.has(outboxId) || this.destinations.has(target)) return "duplicate" as const;
    this.events.set(eventId, Object.freeze({ ...input.event }));
    this.outbox.set(outboxId, Object.freeze({ ...input.outbox }));
    this.destinations.add(target);
    return "created" as const;
  }

  async getEvent(id: string, environment: string) {
    return this.events.get(eventKey(environment, id)) ?? null;
  }

  async getOutbox(id: string, environment: string) {
    return this.outbox.get(outboxKey(environment, id)) ?? null;
  }

  async listDueOutbox(input: { readonly environment: string; readonly now: string; readonly limit: number }) {
    return [...this.outbox.values()]
      .filter((record) => record.environment === input.environment
        && (record.status === "pending" || record.status === "retry_wait")
        && record.availableAt <= input.now)
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.id.localeCompare(right.id))
      .slice(0, input.limit);
  }

  async compareAndSetOutbox(input: { readonly record: OutboxRecord; readonly expectedVersion: number; readonly expectedStatus: OutboxRecord["status"] }) {
    const key = outboxKey(input.record.environment, input.record.id);
    const current = this.outbox.get(key);
    if (!current || current.version !== input.expectedVersion || current.status !== input.expectedStatus) return false;
    this.outbox.set(key, Object.freeze({ ...input.record }));
    return true;
  }
}
