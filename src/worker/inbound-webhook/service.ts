import type { Clock, IdGenerator } from "../../shared/runtime";
import {
  InboundWebhookVerificationError,
  type InboundWebhookBusinessHandler,
  type InboundWebhookBusinessMapper,
  type InboundWebhookHeaders,
  type InboundWebhookReceiptRecord,
  type InboundWebhookReceiptStore,
  type InboundWebhookVerifier,
  type VerifiedInboundWebhookEvent,
} from "./types";

const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const MAX_REPLAY_KEY_LENGTH = 256;
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

export type InboundWebhookHandleResult =
  | { readonly kind: "processed" | "ignored"; readonly receipt: InboundWebhookReceiptRecord }
  | { readonly kind: "duplicate"; readonly receipt: InboundWebhookReceiptRecord };

export interface InboundWebhookServiceOptions<TCommand> {
  readonly environment: string;
  readonly store: InboundWebhookReceiptStore;
  readonly verifier: InboundWebhookVerifier;
  readonly mapper: InboundWebhookBusinessMapper<TCommand>;
  readonly handler: InboundWebhookBusinessHandler<TCommand>;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly maxBodyBytes?: number;
}

export interface HandleInboundWebhookInput {
  readonly providerKey: string;
  readonly headers: InboundWebhookHeaders;
  readonly rawBody: Uint8Array;
}

const assertVerifiedEvent = (
  expectedProviderKey: string,
  event: VerifiedInboundWebhookEvent,
): void => {
  if (event.providerKey !== expectedProviderKey) {
    throw new InboundWebhookVerificationError("provider_mismatch");
  }
  if (!event.replayKey || event.replayKey.length > MAX_REPLAY_KEY_LENGTH) {
    throw new InboundWebhookVerificationError("invalid_replay_key");
  }
  if (!event.eventType || event.eventType.length > 128) {
    throw new InboundWebhookVerificationError("invalid_event_type");
  }
};

export class InboundWebhookService<TCommand> {
  private readonly maxBodyBytes: number;

  constructor(private readonly options: InboundWebhookServiceOptions<TCommand>) {
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  async handle(input: HandleInboundWebhookInput): Promise<InboundWebhookHandleResult> {
    if (!PROVIDER_KEY_PATTERN.test(input.providerKey)) {
      throw new InboundWebhookVerificationError("invalid_provider");
    }
    if (input.rawBody.byteLength === 0 || input.rawBody.byteLength > this.maxBodyBytes) {
      throw new InboundWebhookVerificationError("invalid_body_size");
    }

    const receivedAt = this.options.clock.now().toISOString();
    const event = await this.options.verifier.verify({
      providerKey: input.providerKey,
      headers: input.headers,
      rawBody: input.rawBody,
      receivedAt,
    });
    assertVerifiedEvent(input.providerKey, event);

    const receipt: InboundWebhookReceiptRecord = {
      id: this.options.idGenerator.generate(),
      environment: this.options.environment,
      providerKey: event.providerKey,
      providerEventId: event.providerEventId,
      replayKey: event.replayKey,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      receivedAt,
      status: "received",
      attemptCount: 0,
      failureCode: null,
      version: 1,
      createdAt: receivedAt,
      updatedAt: receivedAt,
      completedAt: null,
    };

    const created = await this.options.store.create(receipt);
    if (created === "duplicate") {
      const existing = await this.options.store.getByReplayKey(
        this.options.environment,
        event.providerKey,
        event.replayKey,
      );
      if (!existing) throw new Error("duplicate receipt could not be resolved");
      return { kind: "duplicate", receipt: existing };
    }

    const processing = await this.transition(receipt, "processing", null, false);
    try {
      const command = await this.options.mapper.map(event);
      if (command === null) {
        const ignored = await this.transition(processing, "ignored", null, true);
        return { kind: "ignored", receipt: ignored };
      }

      await this.options.handler.handle(command, {
        receiptId: processing.id,
        environment: this.options.environment,
      });
      const processed = await this.transition(processing, "processed", null, true);
      return { kind: "processed", receipt: processed };
    } catch (error) {
      const failureCode = error instanceof InboundWebhookVerificationError ? error.code : "business_processing_failed";
      await this.transition(processing, "failed", failureCode, true);
      throw error;
    }
  }

  private async transition(
    current: InboundWebhookReceiptRecord,
    status: InboundWebhookReceiptRecord["status"],
    failureCode: string | null,
    terminal: boolean,
  ): Promise<InboundWebhookReceiptRecord> {
    const now = this.options.clock.now().toISOString();
    const next: InboundWebhookReceiptRecord = {
      ...current,
      status,
      attemptCount: status === "processing" ? current.attemptCount + 1 : current.attemptCount,
      failureCode,
      version: current.version + 1,
      updatedAt: now,
      completedAt: terminal ? now : null,
    };
    const updated = await this.options.store.compareAndSet({
      record: next,
      expectedVersion: current.version,
      expectedStatus: current.status,
    });
    if (!updated) throw new Error("inbound webhook receipt changed concurrently");
    return next;
  }
}
