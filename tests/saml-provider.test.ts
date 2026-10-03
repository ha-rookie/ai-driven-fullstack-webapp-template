import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemorySamlReplayStore,
  SamlAuthProvider,
  SamlProviderError,
  createSamlLoginTransaction,
  type SamlAssertionVerifier,
  type SamlProviderConfig,
  type VerifiedSamlAssertion,
} from "../src/worker/auth";

const now = new Date("2026-10-03T13:30:00.000Z");
const clock = { now: () => now };

const config: SamlProviderConfig = {
  provider: "example-saml",
  idpEntityId: "https://idp.example/metadata",
  idpSsoUrl: "https://idp.example/sso",
  spEntityId: "https://app.example/saml/metadata",
  acsUrl: "https://app.example/api/auth/saml/acs",
  subjectMapping: { source: "attribute", name: "urn:example:stable-user-id" },
  displayNameAttribute: "urn:example:display-name",
};

const assertion = (
  overrides: Partial<VerifiedSamlAssertion> = {},
): VerifiedSamlAssertion => ({
  signatureValidated: true,
  signedElement: "assertion",
  status: "success",
  issuer: config.idpEntityId,
  responseId: "_response-1",
  assertionId: "_assertion-1",
  inResponseTo: "_request-1",
  destination: config.acsUrl,
  recipient: config.acsUrl,
  audiences: [config.spEntityId],
  issuedAt: "2026-10-03T13:29:30.000Z",
  notBefore: "2026-10-03T13:29:00.000Z",
  notOnOrAfter: "2026-10-03T13:35:00.000Z",
  nameId: "person@example.com",
  nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
  attributes: {
    "urn:example:stable-user-id": ["employee-123"],
    "urn:example:display-name": ["Example User"],
    email: ["person@example.com"],
  },
  ...overrides,
});

const verifierReturning = (
  value: VerifiedSamlAssertion,
  calls: string[] = [],
): SamlAssertionVerifier => ({
  async verifySignedResponse(input) {
    calls.push(input.samlResponse);
    return value;
  },
});

const credential = {
  samlResponse: "base64-saml-response",
  returnedRelayState: "relay-1",
  expectedRelayState: "relay-1",
  expectedRequestId: "_request-1",
  expectedRequestCreatedAt: "2026-10-03T13:28:00.000Z",
};

test("SAML AuthnRequest uses HTTP-POST, opaque transaction values and matching SP metadata", () => {
  const provider = new SamlAuthProvider(config, {
    verifier: verifierReturning(assertion()),
    replayStore: new InMemorySamlReplayStore(clock),
    clock,
  });
  const transaction = createSamlLoginTransaction({
    now: () => now,
    randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index + 1),
  });
  const request = provider.createAuthorizationRequest(transaction);
  const xml = Buffer.from(request.fields.SAMLRequest, "base64").toString("utf8");

  assert.equal(request.method, "POST");
  assert.equal(request.destination, config.idpSsoUrl);
  assert.equal(request.fields.RelayState, transaction.relayState);
  assert.match(xml, new RegExp(`ID="${transaction.requestId}"`, "u"));
  assert.match(xml, /ProtocolBinding="urn:oasis:names:tc:SAML:2\.0:bindings:HTTP-POST"/u);
  assert.match(xml, /https:\/\/app\.example\/api\/auth\/saml\/acs/u);
  assert.match(xml, /<saml:Issuer>https:\/\/app\.example\/saml\/metadata<\/saml:Issuer>/u);

  const metadata = provider.createSpMetadata();
  assert.match(metadata, /WantAssertionsSigned="true"/u);
  assert.match(metadata, /entityID="https:\/\/app\.example\/saml\/metadata"/u);
  assert.match(metadata, /Location="https:\/\/app\.example\/api\/auth\/saml\/acs"/u);
});

test("verified assertion is normalized to provider-neutral identity and replay is rejected", async () => {
  const replayStore = new InMemorySamlReplayStore(clock);
  const provider = new SamlAuthProvider(config, {
    verifier: verifierReturning(assertion()),
    replayStore,
    clock,
  });

  const identity = await provider.verify(credential);
  assert.deepEqual(identity, {
    provider: "example-saml",
    subject: "employee-123",
    displayName: "Example User",
  });
  assert.notEqual(identity.subject, "person@example.com");

  await assert.rejects(
    () => provider.verify(credential),
    (error: unknown) => error instanceof SamlProviderError && error.code === "assertion_replayed",
  );
});

test("RelayState mismatch is rejected before signature verifier work", async () => {
  const calls: string[] = [];
  const provider = new SamlAuthProvider(config, {
    verifier: verifierReturning(assertion(), calls),
    replayStore: new InMemorySamlReplayStore(clock),
    clock,
  });

  await assert.rejects(
    () => provider.verify({ ...credential, returnedRelayState: "attacker-relay" }),
    (error: unknown) => error instanceof SamlProviderError && error.code === "transaction_mismatch",
  );
  assert.equal(calls.length, 0);
});

test("Audience, Recipient, InResponseTo and signed element are fail-closed", async () => {
  const invalidAssertions: VerifiedSamlAssertion[] = [
    assertion({ audiences: ["https://other.example/sp"] }),
    assertion({ recipient: "https://attacker.example/acs" }),
    assertion({ inResponseTo: "_different-request" }),
    assertion({ signedElement: "response" }),
  ];

  for (const invalid of invalidAssertions) {
    const provider = new SamlAuthProvider(config, {
      verifier: verifierReturning(invalid),
      replayStore: new InMemorySamlReplayStore(clock),
      clock,
    });
    await assert.rejects(
      () => provider.verify(credential),
      (error: unknown) => error instanceof SamlProviderError && error.code === "assertion_invalid",
    );
  }
});

test("expired and future assertions are rejected", async () => {
  const expired = new SamlAuthProvider(config, {
    verifier: verifierReturning(assertion({ notOnOrAfter: "2026-10-03T13:20:00.000Z" })),
    replayStore: new InMemorySamlReplayStore(clock),
    clock,
  });
  await assert.rejects(
    () => expired.verify(credential),
    (error: unknown) => error instanceof SamlProviderError && error.code === "assertion_expired",
  );

  const future = new SamlAuthProvider(config, {
    verifier: verifierReturning(assertion({ issuedAt: "2026-10-03T14:00:00.000Z" })),
    replayStore: new InMemorySamlReplayStore(clock),
    clock,
  });
  await assert.rejects(
    () => future.verify(credential),
    (error: unknown) => error instanceof SamlProviderError && error.code === "assertion_invalid",
  );
});

test("transient NameID is not a stable identity key unless Project explicitly allows it", async () => {
  const transientConfig: SamlProviderConfig = {
    ...config,
    subjectMapping: { source: "nameId" },
  };
  const provider = new SamlAuthProvider(transientConfig, {
    verifier: verifierReturning(assertion({
      nameId: "temporary-123",
      nameIdFormat: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
    })),
    replayStore: new InMemorySamlReplayStore(clock),
    clock,
  });

  await assert.rejects(
    () => provider.verify(credential),
    (error: unknown) => error instanceof SamlProviderError && error.code === "identity_mapping_invalid",
  );
});

test("signature verifier failure is normalized without leaking raw XML details", async () => {
  const provider = new SamlAuthProvider(config, {
    verifier: {
      async verifySignedResponse() {
        throw new Error("raw XML parser detail: secret assertion fragment");
      },
    },
    replayStore: new InMemorySamlReplayStore(clock),
    clock,
  });

  await assert.rejects(
    () => provider.verify(credential),
    (error: unknown) => error instanceof SamlProviderError
      && error.code === "verification_failed"
      && !error.message.includes("secret assertion fragment"),
  );
});
