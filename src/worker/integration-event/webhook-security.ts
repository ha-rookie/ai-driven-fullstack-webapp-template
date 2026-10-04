import type {
  IntegrationDeliveryAdapter,
  IntegrationDeliveryRequest,
  IntegrationDeliveryResult,
} from "./types";

const MAX_REDIRECTS = 3;
const RETRYABLE_STATUS = new Set([408, 425, 429]);
const SAFE_HOST_PATTERN = /^[a-z0-9.-]+$/;

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

const parseIpv4 = (value: string): readonly number[] | null => {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet, index) => !Number.isInteger(octet) || octet < 0 || octet > 255 || String(octet) !== parts[index])) {
    return null;
  }
  return octets;
};

const isPublicIpv4 = (value: string): boolean => {
  const octets = parseIpv4(value);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false;
  return true;
};

const normalizeIpv6 = (value: string): string => value.toLowerCase().replace(/^\[|\]$/gu, "");

const isPublicIpv6 = (value: string): boolean => {
  const address = normalizeIpv6(value);
  if (!address.includes(":")) return false;
  if (address === "::" || address === "::1") return false;
  if (address.startsWith("fc") || address.startsWith("fd")) return false;
  if (/^fe[89ab]/u.test(address)) return false;
  if (address.startsWith("ff")) return false;
  if (address.startsWith("2001:db8:")) return false;
  if (address.startsWith("::ffff:")) {
    return isPublicIpv4(address.slice("::ffff:".length));
  }
  return true;
};

export const isPublicWebhookAddress = (value: string): boolean =>
  value.includes(":") ? isPublicIpv6(value) : isPublicIpv4(value);

const normalizeHost = (hostname: string): string => hostname.toLowerCase().replace(/\.$/u, "");

const getHeader = (headers: Readonly<Record<string, string>>, name: string): string | null => {
  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  return entry?.[1] ?? null;
};

const serializeEvent = (request: IntegrationDeliveryRequest): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({
    id: request.event.id,
    type: request.event.eventType,
    schemaVersion: request.event.schemaVersion,
    occurredAt: request.event.occurredAt,
    aggregateType: request.event.aggregateType,
    aggregateId: request.event.aggregateId,
    correlationId: request.event.correlationId,
    causationId: request.event.causationId,
    payload: request.event.payload,
  }));

export class SecureWebhookDeliveryAdapter implements IntegrationDeliveryAdapter {
  private readonly allowedHosts: ReadonlySet<string> | null;

  constructor(private readonly options: SecureWebhookDeliveryOptions) {
    this.allowedHosts = options.allowedHosts
      ? new Set(options.allowedHosts.map(normalizeHost))
      : null;
  }

  async deliver(request: IntegrationDeliveryRequest): Promise<IntegrationDeliveryResult> {
    const destination = await this.options.registry.get(request.destinationKey, this.options.environment);
    if (!destination || !destination.enabled || destination.key !== request.destinationKey) {
      return { kind: "permanent_failure", failureCode: "destination_unavailable" };
    }

    const body = serializeEvent(request);
    const timestamp = this.options.now().toISOString();
    const signedHeaders = this.options.signer
      ? await this.options.signer.sign({
          destinationKey: destination.key,
          eventId: request.event.id,
          timestamp,
          body,
        })
      : {};
    const headers: Readonly<Record<string, string>> = {
      "content-type": "application/json",
      "x-webhook-id": request.event.id,
      "x-webhook-timestamp": timestamp,
      ...signedHeaders,
    };

    let currentUrl = destination.endpoint;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const validated = await this.validateUrl(currentUrl);
      if (!validated.ok) return { kind: "permanent_failure", failureCode: validated.failureCode };

      const response = await this.options.transport.post({
        url: validated.url,
        headers,
        body,
        redirect: "manual",
      });
      if (response.status >= 200 && response.status < 300) return { kind: "delivered" };

      if (response.status === 307 || response.status === 308) {
        if (redirects === MAX_REDIRECTS) {
          return { kind: "permanent_failure", failureCode: "too_many_redirects" };
        }
        const location = getHeader(response.headers, "location");
        if (!location) return { kind: "permanent_failure", failureCode: "redirect_without_location" };
        try {
          currentUrl = new URL(location, validated.url).toString();
        } catch {
          return { kind: "permanent_failure", failureCode: "invalid_redirect" };
        }
        continue;
      }

      if (response.status >= 500 || RETRYABLE_STATUS.has(response.status)) {
        return { kind: "retryable_failure", failureCode: `http_${response.status}` };
      }
      return { kind: "permanent_failure", failureCode: `http_${response.status}` };
    }

    return { kind: "permanent_failure", failureCode: "redirect_policy_exhausted" };
  }

  private async validateUrl(rawUrl: string): Promise<
    | { readonly ok: true; readonly url: string }
    | { readonly ok: false; readonly failureCode: string }
  > {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, failureCode: "invalid_destination_url" };
    }
    if (url.protocol !== "https:") return { ok: false, failureCode: "https_required" };
    if (url.username || url.password) return { ok: false, failureCode: "userinfo_not_allowed" };
    if (url.port && url.port !== "443") return { ok: false, failureCode: "nonstandard_port_not_allowed" };

    const hostname = normalizeHost(url.hostname);
    if (!hostname || hostname === "localhost" || !SAFE_HOST_PATTERN.test(hostname)) {
      return { ok: false, failureCode: "invalid_destination_host" };
    }
    if (this.allowedHosts && !this.allowedHosts.has(hostname)) {
      return { ok: false, failureCode: "destination_not_allowlisted" };
    }

    const addresses = await this.options.resolver.resolve(hostname);
    if (addresses.length === 0) return { ok: false, failureCode: "destination_unresolved" };
    if (addresses.some((address) => !isPublicWebhookAddress(address))) {
      return { ok: false, failureCode: "destination_address_not_public" };
    }
    return { ok: true, url: url.toString() };
  }
}
