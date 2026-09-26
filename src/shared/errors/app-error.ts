export interface AppErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly userMessage?: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly userMessage?: string;
  readonly retryable: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.userMessage = options.userMessage;
    this.retryable = options.retryable ?? false;
  }
}
