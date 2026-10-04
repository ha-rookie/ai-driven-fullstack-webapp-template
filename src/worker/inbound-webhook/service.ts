import type { Clock, IdGenerator } from "../../shared/runtime";
import {
  InboundWebhookProcessingError,
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
const DEFAULT_MAX_PROCESSING_ATTEMPTS = 3;

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
  readonly maxProcessingAttempts?: number;
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
  private readonly maxProcessingAttempts: number;

  constructor(private readonly options: InboundWebhookServiceOptions<TCommand>) {
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.maxProcessingAttempts = options.maxProcessingAttempts ?? DEFAULT_MAX_PROCESSING_ATTEMPTS;
    if (!Number.isInteger(this.maxProcessingAttempts) || this.maxProcessingAttempts < 1) {
      throw new RangeError("maxProcessingAttempts must be a positive integer");
    }
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
    if (created === "created") return this.process(receipt, event);

    const existing = await this.options.store.getByReplayKey(
      this.options.environment,
      event.providerKey,
      event.replayKey,
    );
    if (!existing) throw new Error("duplicate receipt could not be resolved");

    if (existing.status === "received" || existing.status === "failed") {
      return this.process(existing, event);
    }
    return { kind: "duplicate", receipt: existing };
  }

  private async process(
    receipt: InboundWebhookReceiptRecord,
    event: VerifiedInboundWebhookEvent,
  ): Promise<InboundWebhookHandleResult> {
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
      const classified = error instanceof InboundWebhookProcessingError
        ? error
        : new InboundWebhookProcessingError("business_processing_failed", false);
      const exhausted = processing.attemptCount >= this.maxProcessingAttempts;
      await this.transition(
        processing,
        classified.retryable && !exhausted ? "failed" : "dead_letter",
        classified.code,
        !classified.retryable || exhausted,
      );
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
