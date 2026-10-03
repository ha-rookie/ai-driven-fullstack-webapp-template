import type {
  EmailProvider,
  EmailSendResult,
  ResolvedTransactionalEmail,
} from "./email";

export interface InMemoryEmailProviderOptions {
  readonly failure?: Error;
}

export class InMemoryEmailProvider implements EmailProvider {
  readonly sent: ResolvedTransactionalEmail[] = [];

  constructor(private readonly options: InMemoryEmailProviderOptions = {}) {}

  async send(message: ResolvedTransactionalEmail): Promise<EmailSendResult> {
    if (this.options.failure !== undefined) throw this.options.failure;
    this.sent.push(structuredClone(message));
    return { messageId: `in-memory-${this.sent.length}` };
  }
}
