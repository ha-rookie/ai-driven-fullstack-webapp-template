import {
  EmailDeliveryError,
  type EmailAddress,
  type EmailDeliveryErrorCode,
  type EmailProvider,
  type EmailSendResult,
  type ResolvedTransactionalEmail,
} from "./email";

interface CloudflareEmailAddress {
  readonly email: string;
  readonly name?: string;
}

interface CloudflareEmailMessageBuilder {
  readonly to: CloudflareEmailAddress | readonly CloudflareEmailAddress[];
  readonly from: CloudflareEmailAddress;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly cc?: readonly CloudflareEmailAddress[];
  readonly bcc?: readonly CloudflareEmailAddress[];
  readonly replyTo?: CloudflareEmailAddress;
}

export interface CloudflareEmailBinding {
  send(message: CloudflareEmailMessageBuilder): Promise<{ readonly messageId: string }>;
}

interface ProviderErrorLike {
  readonly code?: unknown;
}

const toCloudflareAddress = (address: EmailAddress): CloudflareEmailAddress => ({
  email: address.email,
  ...(address.name === undefined ? {} : { name: address.name }),
});

const errorCodeFromUnknown = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as ProviderErrorLike).code;
  return typeof code === "string" ? code : undefined;
};

const mapCloudflareError = (
  error: unknown,
): { code: EmailDeliveryErrorCode; retryable: boolean } => {
  switch (errorCodeFromUnknown(error)) {
    case "E_VALIDATION_ERROR":
    case "E_FIELD_MISSING":
    case "E_TOO_MANY_RECIPIENTS":
    case "E_TOO_MANY_ATTACHMENTS":
    case "E_HEADER_NOT_ALLOWED":
    case "E_HEADER_USE_API_FIELD":
    case "E_HEADER_VALUE_INVALID":
    case "E_HEADER_VALUE_TOO_LONG":
    case "E_HEADER_NAME_INVALID":
    case "E_HEADERS_TOO_LARGE":
    case "E_HEADERS_TOO_MANY":
      return { code: "invalid_message", retryable: false };
    case "E_SENDER_NOT_VERIFIED":
    case "E_SENDER_DOMAIN_NOT_AVAILABLE":
      return { code: "sender_rejected", retryable: false };
    case "E_RECIPIENT_NOT_ALLOWED":
    case "E_RECIPIENT_SUPPRESSED":
      return { code: "recipient_rejected", retryable: false };
    case "E_CONTENT_TOO_LARGE":
      return { code: "content_too_large", retryable: false };
    case "E_RATE_LIMIT_EXCEEDED":
    case "E_DAILY_LIMIT_EXCEEDED":
      return { code: "rate_limited", retryable: true };
    case "E_DELIVERY_FAILED":
      return { code: "delivery_failed", retryable: true };
    case "E_INTERNAL_SERVER_ERROR":
      return { code: "provider_unavailable", retryable: true };
    default:
      // Unknown provider failures can be ambiguous: the provider may have accepted
      // the message before the caller observed the failure. Do not recommend an
      // automatic retry by default because that can duplicate transactional mail.
      return { code: "provider_error", retryable: false };
  }
};

export class CloudflareEmailProvider implements EmailProvider {
  constructor(private readonly binding: CloudflareEmailBinding) {}

  async send(message: ResolvedTransactionalEmail): Promise<EmailSendResult> {
    try {
      const response = await this.binding.send({
        from: toCloudflareAddress(message.from),
        to: message.to.map(toCloudflareAddress),
        subject: message.subject,
        ...(message.text === undefined ? {} : { text: message.text }),
        ...(message.html === undefined ? {} : { html: message.html }),
        ...(message.cc.length === 0 ? {} : { cc: message.cc.map(toCloudflareAddress) }),
        ...(message.bcc.length === 0 ? {} : { bcc: message.bcc.map(toCloudflareAddress) }),
        ...(message.replyTo === undefined
          ? {}
          : { replyTo: toCloudflareAddress(message.replyTo) }),
      });
      return { messageId: response.messageId };
    } catch (error) {
      const mapped = mapCloudflareError(error);
      throw new EmailDeliveryError(
        mapped.code,
        mapped.retryable,
        "Email provider rejected the delivery request",
        { cause: error },
      );
    }
  }
}
