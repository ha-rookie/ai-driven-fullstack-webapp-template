import type {
  InboundWebhookReceiptRecord,
  InboundWebhookReceiptStore,
  InboundWebhookReceiptStatus,
} from "./types";

const clone = (record: InboundWebhookReceiptRecord): InboundWebhookReceiptRecord => ({ ...record });
const replayIdentity = (environment: string, providerKey: string, replayKey: string) =>
  `${environment}\u0000${providerKey}\u0000${replayKey}`;

export class InMemoryInboundWebhookReceiptStore implements InboundWebhookReceiptStore {
  private readonly records = new Map<string, InboundWebhookReceiptRecord>();
  private readonly replayKeys = new Map<string, string>();

  async create(record: InboundWebhookReceiptRecord): Promise<"created" | "duplicate"> {
    const identity = replayIdentity(record.environment, record.providerKey, record.replayKey);
    if (this.records.has(record.id) || this.replayKeys.has(identity)) return "duplicate";
    this.records.set(record.id, clone(record));
    this.replayKeys.set(identity, record.id);
    return "created";
  }

  async get(id: string, environment: string): Promise<InboundWebhookReceiptRecord | null> {
    const record = this.records.get(id);
    return record?.environment === environment ? clone(record) : null;
  }

  async getByReplayKey(
    environment: string,
    providerKey: string,
    replayKey: string,
  ): Promise<InboundWebhookReceiptRecord | null> {
    const id = this.replayKeys.get(replayIdentity(environment, providerKey, replayKey));
    return id ? this.get(id, environment) : null;
  }

  async compareAndSet(input: {
    readonly record: InboundWebhookReceiptRecord;
    readonly expectedVersion: number;
    readonly expectedStatus: InboundWebhookReceiptStatus;
  }): Promise<boolean> {
    const current = this.records.get(input.record.id);
    if (!current || current.environment !== input.record.environment) return false;
    if (current.version !== input.expectedVersion || current.status !== input.expectedStatus) return false;
    this.records.set(input.record.id, clone(input.record));
    return true;
  }
}
