export type InboundWebhookReceiptStatus = "received" | "processing" | "processed" | "ignored" | "failed" | "dead_letter";

export interface InboundWebhookHeaders {
  get(name: string): string | null;
}

export interface VerifiedInboundWebhookEvent {
  readonly providerKey: string;
  readonly providerEventId: string | null;
  readonly replayKey: string;
  readonly eventType: string;
  readonly occurredAt: string | null;
  readonly payload: unknown;
}

export interface InboundWebhookVerificationInput {
  readonly providerKey: string;
  readonly headers: InboundWebhookHeaders;
  readonly rawBody: Uint8Array;
  readonly receivedAt: string;
}

export interface InboundWebhookVerifier {
  verify(input: InboundWebhookVerificationInput): Promise<VerifiedInboundWebhookEvent>;
}

export interface InboundWebhookReceiptRecord {
  readonly id: string;
  readonly environment: string;
  readonly providerKey: string;
  readonly providerEventId: string | null;
  readonly replayKey: string;
  readonly eventType: string;
  readonly occurredAt: string | null;
  readonly receivedAt: string;
  readonly status: InboundWebhookReceiptStatus;
  readonly attemptCount: number;
  readonly failureCode: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface InboundWebhookReceiptStore {
  create(record: InboundWebhookReceiptRecord): Promise<"created" | "duplicate">;
  get(id: string, environment: string): Promise<InboundWebhookReceiptRecord | null>;
  getByReplayKey(environment: string, providerKey: string, replayKey: string): Promise<InboundWebhookReceiptRecord | null>;
  compareAndSet(input: {
    readonly record: InboundWebhookReceiptRecord;
    readonly expectedVersion: number;
    readonly expectedStatus: InboundWebhookReceiptStatus;
  }): Promise<boolean>;
}

export interface InboundWebhookBusinessMapper<TCommand = unknown> {
  map(event: VerifiedInboundWebhookEvent): Promise<TCommand | null> | TCommand | null;
}

export interface InboundWebhookBusinessHandler<TCommand = unknown> {
  handle(command: TCommand, context: { readonly receiptId: string; readonly environment: string }): Promise<void>;
}

export class InboundWebhookVerificationError extends Error {
  constructor(readonly code: string, message = "Inbound webhook verification failed") {
    super(message);
    this.name = "InboundWebhookVerificationError";
  }
}
