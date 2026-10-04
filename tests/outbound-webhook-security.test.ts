import assert from "node:assert/strict";
import test from "node:test";

import {
  SecureWebhookDeliveryAdapter,
  isPublicWebhookAddress,
  type IntegrationDeliveryRequest,
  type WebhookDestinationRegistry,
  type WebhookTransport,
} from "../src/worker/integration-event";

const request: IntegrationDeliveryRequest = {
  event: {
    id: "event-1",
    environment: "test",
    eventType: "travel.approved",
    schemaVersion: 1,
    aggregateType: "travel_request",
    aggregateId: "travel-1",
    occurredAt: "2026-10-04T12:00:00.000Z",
    correlationId: null,
    causationId: null,
    payload: { travelRequestId: "travel-1" },
    createdAt: "2026-10-04T12:00:00.000Z",
  },
  destinationKey: "reference-webhook",
  attempt: 1,
};

const registry = (endpoint: string, enabled = true): WebhookDestinationRegistry => ({
  async get(key) {
    return { key, endpoint, enabled };
  },
});

const successTransport = (): WebhookTransport => ({
  async post() {
    return { status: 204, headers: {} };
  },
});

const adapter = (input: {
  endpoint?: string;
  addresses?: readonly string[];
  transport?: WebhookTransport;
  allowedHosts?: readonly string[];
}) => new SecureWebhookDeliveryAdapter({
  environment: "test",
  registry: registry(input.endpoint ?? "https://hooks.example.com/events"),
  resolver: { async resolve() { return input.addresses ?? ["93.184.216.34"]; } },
  transport: input.transport ?? successTransport(),
  allowedHosts: input.allowedHosts,
  now: () => new Date("2026-10-04T12:00:00.000Z"),
});

test("rejects non-HTTPS, userinfo, nonstandard ports, and non-allowlisted destinations", async () => {
  assert.deepEqual(
    await adapter({ endpoint: "http://hooks.example.com/events" }).deliver(request),
    { kind: "permanent_failure", failureCode: "https_required" },
  );
  assert.deepEqual(
    await adapter({ endpoint: "https://user:pass@hooks.example.com/events" }).deliver(request),
    { kind: "permanent_failure", failureCode: "userinfo_not_allowed" },
  );
  assert.deepEqual(
    await adapter({ endpoint: "https://hooks.example.com:8443/events" }).deliver(request),
    { kind: "permanent_failure", failureCode: "nonstandard_port_not_allowed" },
  );
  assert.deepEqual(
    await adapter({ allowedHosts: ["approved.example.com"] }).deliver(request),
    { kind: "permanent_failure", failureCode: "destination_not_allowlisted" },
  );
});

test("rejects loopback, private, link-local, metadata-range, malformed, and mixed DNS answers", async () => {
  const blocked = [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "not:an:ip",
  ];
  for (const address of blocked) {
    assert.equal(isPublicWebhookAddress(address), false, address);
  }
  assert.equal(isPublicWebhookAddress("93.184.216.34"), true);
  assert.equal(isPublicWebhookAddress("2606:2800:220:1:248:1893:25c8:1946"), true);

  assert.deepEqual(
    await adapter({ addresses: ["93.184.216.34", "10.0.0.1"] }).deliver(request),
    { kind: "permanent_failure", failureCode: "destination_address_not_public" },
  );
});

test("passes only validated DNS answers to transport so transport can pin the connection", async () => {
  let captured: Parameters<WebhookTransport["post"]>[0] | null = null;
  const transport: WebhookTransport = {
    async post(input) {
      captured = input;
      return { status: 204, headers: {} };
    },
  };
  const result = await adapter({ addresses: ["93.184.216.34"], transport }).deliver(request);
  assert.equal(result.kind, "delivered");
  assert.deepEqual(captured?.resolvedAddresses, ["93.184.216.34"]);
  assert.equal(captured?.redirect, "manual");
});

test("307/308 redirects are revalidated and private redirect targets are blocked", async () => {
  let calls = 0;
  const transport: WebhookTransport = {
    async post() {
      calls += 1;
      if (calls === 1) return { status: 307, headers: { location: "https://internal.example.com/hook" } };
      return { status: 204, headers: {} };
    },
  };
  const delivery = new SecureWebhookDeliveryAdapter({
    environment: "test",
    registry: registry("https://hooks.example.com/events"),
    resolver: {
      async resolve(hostname) {
        return hostname === "internal.example.com" ? ["10.0.0.2"] : ["93.184.216.34"];
      },
    },
    transport,
    now: () => new Date("2026-10-04T12:00:00.000Z"),
  });
  assert.deepEqual(
    await delivery.deliver(request),
    { kind: "permanent_failure", failureCode: "destination_address_not_public" },
  );
  assert.equal(calls, 1);
});

test("does not follow POST-changing redirects and classifies retryable/permanent statuses", async () => {
  const response = async (status: number) => adapter({
    transport: { async post() { return { status, headers: { location: "https://hooks.example.com/next" } }; } },
  }).deliver(request);

  assert.deepEqual(await response(302), { kind: "permanent_failure", failureCode: "http_302" });
  assert.deepEqual(await response(429), { kind: "retryable_failure", failureCode: "http_429" });
  assert.deepEqual(await response(503), { kind: "retryable_failure", failureCode: "http_503" });
  assert.deepEqual(await response(400), { kind: "permanent_failure", failureCode: "http_400" });
});

test("signer receives bounded signing inputs and returned headers are sent without exposing key material", async () => {
  let signed = false;
  let authorizationHeader: string | undefined;
  const delivery = new SecureWebhookDeliveryAdapter({
    environment: "test",
    registry: registry("https://hooks.example.com/events"),
    resolver: { async resolve() { return ["93.184.216.34"]; } },
    signer: {
      async sign(input) {
        signed = input.eventId === "event-1" && input.destinationKey === "reference-webhook" && input.body.byteLength > 0;
        return { "x-webhook-signature": "reference-signature" };
      },
    },
    transport: {
      async post(input) {
        authorizationHeader = input.headers.authorization;
        assert.equal(input.headers["x-webhook-signature"], "reference-signature");
        return { status: 204, headers: {} };
      },
    },
    now: () => new Date("2026-10-04T12:00:00.000Z"),
  });

  assert.equal((await delivery.deliver(request)).kind, "delivered");
  assert.equal(signed, true);
  assert.equal(authorizationHeader, undefined);
});
