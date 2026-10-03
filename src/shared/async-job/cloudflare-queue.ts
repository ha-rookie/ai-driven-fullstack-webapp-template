import type {
  AsyncJobEnvelope,
  AsyncJobExecutionResult,
  AsyncJobPublisher,
  AsyncJobPublishOptions,
} from "./async-job";

export interface CloudflareQueueBinding<TMessage> {
  send(message: TMessage, options?: { readonly delaySeconds?: number }): Promise<void>;
}

export interface CloudflareQueueMessageLike<TMessage> {
  readonly body: TMessage;
  ack(): void;
  retry(options?: { readonly delaySeconds?: number }): void;
}

export interface CloudflareQueuePublisherOptions {
  readonly maxDelaySeconds?: number;
}

const toDelaySeconds = (
  delayMs: number | undefined,
  maximum?: number,
): number | undefined => {
  if (delayMs === undefined || delayMs <= 0) return undefined;
  if (!Number.isFinite(delayMs)) throw new RangeError("delayMs must be finite");
  const seconds = Math.max(1, Math.ceil(delayMs / 1000));
  if (maximum !== undefined && seconds > maximum) {
    throw new RangeError(`Queue delay exceeds configured maximum of ${maximum} seconds`);
  }
  return seconds;
};

export class CloudflareQueueAsyncJobPublisher implements AsyncJobPublisher {
  constructor(
    private readonly queue: CloudflareQueueBinding<AsyncJobEnvelope>,
    private readonly options: CloudflareQueuePublisherOptions = {},
  ) {
    if (
      options.maxDelaySeconds !== undefined
      && (!Number.isSafeInteger(options.maxDelaySeconds) || options.maxDelaySeconds <= 0)
    ) {
      throw new RangeError("maxDelaySeconds must be a positive safe integer");
    }
  }

  async publish<TPayload>(
    envelope: AsyncJobEnvelope<TPayload>,
    options?: AsyncJobPublishOptions,
  ): Promise<void> {
    const delaySeconds = toDelaySeconds(options?.delayMs, this.options.maxDelaySeconds);
    await this.queue.send(
      envelope,
      delaySeconds === undefined ? undefined : { delaySeconds },
    );
  }
}

export interface ConsumeCloudflareQueueMessageOptions {
  readonly maximumRetryDelaySeconds?: number;
  readonly onTerminal?: (result: AsyncJobExecutionResult) => void;
}

const retryMessage = (
  message: CloudflareQueueMessageLike<AsyncJobEnvelope>,
  retryAfterMs: number,
  maximumRetryDelaySeconds?: number,
): void => {
  const delaySeconds = toDelaySeconds(retryAfterMs, maximumRetryDelaySeconds);
  message.retry(delaySeconds === undefined ? undefined : { delaySeconds });
};

export const consumeCloudflareQueueMessage = async <TPayload>(
  message: CloudflareQueueMessageLike<AsyncJobEnvelope<TPayload>>,
  execute: (envelope: AsyncJobEnvelope<TPayload>) => Promise<AsyncJobExecutionResult>,
  options: ConsumeCloudflareQueueMessageOptions = {},
): Promise<AsyncJobExecutionResult> => {
  const result = await execute(message.body);

  switch (result.kind) {
    case "retry":
      retryMessage(message, result.delayMs, options.maximumRetryDelaySeconds);
      break;
    case "busy":
    case "not_due":
    case "lost_lease":
      retryMessage(message, result.retryAfterMs, options.maximumRetryDelaySeconds);
      break;
    case "completed":
    case "duplicate_completed":
      message.ack();
      break;
    case "failed":
    case "dead_letter":
    case "terminal_duplicate":
    case "conflict":
      message.ack();
      options.onTerminal?.(result);
      break;
  }

  return result;
};
