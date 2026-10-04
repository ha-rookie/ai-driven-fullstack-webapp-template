import type { IntegrationDeliveryRequest, IntegrationDeliveryResult } from "./types";

export interface WebhookDestination {
  readonly key: string;
  readonly endpoint: string;
  readonly enabled: boolean;
}

export interface WebhookDestinationRegistry {
  get(destinationKey: string, environment: string): Promise<WebhookDestination | null>;
}

export interface WebhookAddressResolver {
  resolve(hostname: string): Promise<readonly string[]>;
}

export interface WebhookSigner {
  sign(input: {
    readonly destinationKey: string;
    readonly eventId: string;
    readonly timestamp: string;
    readonly body: Uint8Array;
  }): Promise<Readonly<Record<string, string>>>;
}

export interface WebhookTransport {
  post(input: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly redirect: "manual";
  }): Promise<{
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
  }>;
}

export interface SecureWebhookDeliveryOptions {
  readonly environment: string;
  readonly registry: WebhookDestinationRegistry;
  readonly resolver: WebhookAddressResolver;
  readonly transport: WebhookTransport;
  readonly signer?: WebhookSigner;
  readonly allowedHosts?: readonly string[];
  readonly now: () => Date;
}

export interface SecureWebhookDeliveryAdapter {
  deliver(request: IntegrationDeliveryRequest): Promise<IntegrationDeliveryResult>;
}
