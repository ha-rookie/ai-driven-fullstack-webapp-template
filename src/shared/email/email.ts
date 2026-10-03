export interface EmailAddress {
  readonly email: string;
  readonly name?: string;
}

export type EmailRecipient = string | EmailAddress;

export interface TransactionalEmailRequest {
  readonly to: EmailRecipient | readonly EmailRecipient[];
  readonly cc?: EmailRecipient | readonly EmailRecipient[];
  readonly bcc?: EmailRecipient | readonly EmailRecipient[];
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly replyTo?: EmailRecipient;
}

export interface EmailDeliveryConfigInput {
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly replyToAddress?: string;
  readonly replyToName?: string;
}

export interface EmailDeliveryConfig {
  readonly from: EmailAddress;
  readonly replyTo?: EmailAddress;
}

export interface ResolvedTransactionalEmail {
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly cc: readonly EmailAddress[];
  readonly bcc: readonly EmailAddress[];
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly replyTo?: EmailAddress;
}

export interface EmailSendResult {
  readonly messageId?: string;
}

export interface EmailProvider {
  send(message: ResolvedTransactionalEmail): Promise<EmailSendResult>;
}

export type EmailDeliveryErrorCode =
  | "invalid_message"
  | "sender_rejected"
  | "recipient_rejected"
  | "content_too_large"
  | "rate_limited"
  | "delivery_failed"
  | "provider_unavailable"
  | "provider_error";

export class EmailDeliveryError extends Error {
  constructor(
    readonly code: EmailDeliveryErrorCode,
    readonly retryable: boolean,
    message = "Email delivery failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EmailDeliveryError";
  }
}

export interface SafeEmailDeliveryFields {
  readonly recipientCount: number;
  readonly hasText: boolean;
  readonly hasHtml: boolean;
  readonly hasReplyTo: boolean;
}

const MAX_EMAIL_ADDRESS_LENGTH = 320;
const MAX_DISPLAY_NAME_LENGTH = 256;
const MAX_SUBJECT_LENGTH = 998;

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
};

const assertBoundedText = (
  value: string,
  name: string,
  maximum: number,
  allowEmpty = false,
): string => {
  const normalized = value.trim();
  if ((!allowEmpty && normalized.length === 0) || normalized.length > maximum || hasControlCharacter(normalized)) {
    throw new EmailDeliveryError("invalid_message", false, `${name} is invalid`);
  }
  return normalized;
};

export const normalizeEmailAddress = (recipient: EmailRecipient): EmailAddress => {
  const rawEmail = typeof recipient === "string" ? recipient : recipient.email;
  const email = assertBoundedText(rawEmail, "email address", MAX_EMAIL_ADDRESS_LENGTH);
  const atIndex = email.indexOf("@");
  if (
    atIndex <= 0
    || atIndex !== email.lastIndexOf("@")
    || atIndex === email.length - 1
    || /\s/u.test(email)
  ) {
    throw new EmailDeliveryError("invalid_message", false, "email address is invalid");
  }

  if (typeof recipient === "string" || recipient.name === undefined) {
    return Object.freeze({ email });
  }

  const name = assertBoundedText(recipient.name, "email display name", MAX_DISPLAY_NAME_LENGTH);
  return Object.freeze({ email, name });
};

const normalizeRecipientList = (
  recipients: EmailRecipient | readonly EmailRecipient[] | undefined,
  required: boolean,
): readonly EmailAddress[] => {
  if (recipients === undefined) {
    if (required) throw new EmailDeliveryError("invalid_message", false, "recipient is required");
    return Object.freeze([]);
  }
  const list = Array.isArray(recipients) ? recipients : [recipients];
  if (required && list.length === 0) {
    throw new EmailDeliveryError("invalid_message", false, "recipient is required");
  }
  return Object.freeze(list.map((recipient) => normalizeEmailAddress(recipient)));
};

export const createEmailDeliveryConfig = (
  input: EmailDeliveryConfigInput,
): EmailDeliveryConfig => {
  const from = normalizeEmailAddress({
    email: input.fromAddress,
    ...(input.fromName === undefined ? {} : { name: input.fromName }),
  });

  if (input.replyToAddress === undefined && input.replyToName !== undefined) {
    throw new EmailDeliveryError(
      "invalid_message",
      false,
      "replyToName requires replyToAddress",
    );
  }

  const replyTo = input.replyToAddress === undefined
    ? undefined
    : normalizeEmailAddress({
        email: input.replyToAddress,
        ...(input.replyToName === undefined ? {} : { name: input.replyToName }),
      });

  return Object.freeze({ from, ...(replyTo === undefined ? {} : { replyTo }) });
};

export const resolveTransactionalEmail = (
  config: EmailDeliveryConfig,
  request: TransactionalEmailRequest,
): ResolvedTransactionalEmail => {
  const subject = assertBoundedText(request.subject, "subject", MAX_SUBJECT_LENGTH);
  const text = request.text === undefined ? undefined : request.text;
  const html = request.html === undefined ? undefined : request.html;
  if ((text === undefined || text.length === 0) && (html === undefined || html.length === 0)) {
    throw new EmailDeliveryError(
      "invalid_message",
      false,
      "transactional email requires text or html content",
    );
  }

  const to = normalizeRecipientList(request.to, true);
  const cc = normalizeRecipientList(request.cc, false);
  const bcc = normalizeRecipientList(request.bcc, false);
  const replyTo = request.replyTo === undefined
    ? config.replyTo
    : normalizeEmailAddress(request.replyTo);

  return Object.freeze({
    from: config.from,
    to,
    cc,
    bcc,
    subject,
    ...(text === undefined ? {} : { text }),
    ...(html === undefined ? {} : { html }),
    ...(replyTo === undefined ? {} : { replyTo }),
  });
};

export const toSafeEmailDeliveryFields = (
  message: ResolvedTransactionalEmail,
): SafeEmailDeliveryFields => Object.freeze({
  recipientCount: message.to.length + message.cc.length + message.bcc.length,
  hasText: message.text !== undefined,
  hasHtml: message.html !== undefined,
  hasReplyTo: message.replyTo !== undefined,
});

export class TransactionalEmailService {
  constructor(
    private readonly provider: EmailProvider,
    private readonly config: EmailDeliveryConfig,
  ) {}

  send(request: TransactionalEmailRequest): Promise<EmailSendResult> {
    return this.provider.send(resolveTransactionalEmail(this.config, request));
  }
}
