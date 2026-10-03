import assert from "node:assert/strict";
import test from "node:test";

import {
  OidcAuthProvider,
  OidcProviderError,
  createGoogleOidcProviderConfig,
  createOidcLoginTransaction,
  type OidcProviderConfig,
} from "../src/worker/auth";

const discoveryUrl = "https://issuer.example/.well-known/openid-configuration";
const issuer = "https://issuer.example";
const authorizationEndpoint = "https://issuer.example/authorize";
const tokenEndpoint = "https://issuer.example/token";
const jwksUri = "https://issuer.example/jwks";
const clientId = "client-123";
const redirectUri = "https://app.example/api/auth/callback";
const now = new Date("2026-10-03T12:00:00.000Z");

const config: OidcProviderConfig = {
  provider: "example-oidc",
  discoveryUrl,
  clientId,
  clientSecret: "test-client-secret",
  allowedIssuers: [issuer],
  scopes: ["openid", "profile", "email"],
};

const encodeJson = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

const createSigningFixture = async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicJwk: { ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" },
  };
};

const signIdToken = async (
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
): Promise<string> => {
  const encodedHeader = encodeJson({ alg: "RS256", kid: "test-key", typ: "JWT" });
  const encodedClaims = encodeJson(claims);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
};

const makeFetcher = (
  idToken: string,
  publicJwk: JsonWebKey & { kid: string; alg: string; use: string },
  requests: Array<{ url: string; init?: RequestInit }>,
): typeof fetch => async (input, init) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  requests.push({ url, init });

  if (url === discoveryUrl) {
    return Response.json({
      issuer,
      authorization_endpoint: authorizationEndpoint,
      token_endpoint: tokenEndpoint,
      jwks_uri: jwksUri,
    });
  }
  if (url === tokenEndpoint) {
    return Response.json({ id_token: idToken, access_token: "must-not-be-used" });
  }
  if (url === jwksUri) return Response.json({ keys: [publicJwk] });
  return new Response("not found", { status: 404 });
};

test("authorization request uses state, nonce and S256 PKCE", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new OidcAuthProvider(config, {
    fetcher: makeFetcher("unused", { kty: "RSA", kid: "unused", alg: "RS256", use: "sig" }, requests),
  });
  const transaction = await createOidcLoginTransaction({
    now: () => now,
    randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index + 1),
  });
  const request = await provider.createAuthorizationRequest(redirectUri, {
    transaction,
    loginHint: "user@example.com",
  });
  const url = new URL(request.url);

  assert.equal(url.origin + url.pathname, authorizationEndpoint);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), clientId);
  assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(url.searchParams.get("state"), transaction.state);
  assert.equal(url.searchParams.get("nonce"), transaction.nonce);
  assert.equal(url.searchParams.get("code_challenge"), transaction.codeChallenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("login_hint"), "user@example.com");
  assert.notEqual(transaction.codeVerifier, transaction.codeChallenge);
});

test("authorization code exchange verifies signed ID token and returns provider-neutral identity", async () => {
  const fixture = await createSigningFixture();
  const nonce = "nonce-123";
  const idToken = await signIdToken(fixture.privateKey, {
    iss: issuer,
    sub: "subject-456",
    aud: clientId,
    exp: Math.floor(now.getTime() / 1000) + 300,
    iat: Math.floor(now.getTime() / 1000) - 10,
    nonce,
    name: "Example User",
    email: "not-an-identity-key@example.com",
  });
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const provider = new OidcAuthProvider(config, {
    fetcher: makeFetcher(idToken, fixture.publicJwk, requests),
    now: () => now,
  });

  const identity = await provider.verify({
    code: "authorization-code",
    returnedState: "state-123",
    expectedState: "state-123",
    redirectUri,
    codeVerifier: "verifier-123",
    expectedNonce: nonce,
  });

  assert.deepEqual(identity, {
    provider: "example-oidc",
    subject: "subject-456",
    displayName: "Example User",
  });
  const tokenRequest = requests.find((request) => request.url === tokenEndpoint);
  assert.ok(tokenRequest);
  const body = String(tokenRequest.init?.body);
  assert.match(body, /grant_type=authorization_code/u);
  assert.match(body, /code_verifier=verifier-123/u);
  assert.match(body, /client_secret=test-client-secret/u);
  assert.doesNotMatch(JSON.stringify(identity), /not-an-identity-key/u);
});

test("state mismatch is rejected before provider network calls", async () => {
  let called = false;
  const provider = new OidcAuthProvider(config, {
    fetcher: (async () => {
      called = true;
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch,
  });

  await assert.rejects(
    () => provider.verify({
      code: "authorization-code",
      returnedState: "attacker-state",
      expectedState: "expected-state",
      redirectUri,
      codeVerifier: "verifier",
      expectedNonce: "nonce",
    }),
    (error: unknown) => error instanceof OidcProviderError && error.code === "state_mismatch",
  );
  assert.equal(called, false);
});

test("nonce and audience are validated after signature verification", async () => {
  const fixture = await createSigningFixture();
  const idToken = await signIdToken(fixture.privateKey, {
    iss: issuer,
    sub: "subject-456",
    aud: "different-client",
    exp: Math.floor(now.getTime() / 1000) + 300,
    iat: Math.floor(now.getTime() / 1000),
    nonce: "wrong-nonce",
  });
  const provider = new OidcAuthProvider(config, {
    fetcher: makeFetcher(idToken, fixture.publicJwk, []),
    now: () => now,
  });

  await assert.rejects(
    () => provider.verify({
      code: "authorization-code",
      returnedState: "state",
      expectedState: "state",
      redirectUri,
      codeVerifier: "verifier",
      expectedNonce: "expected-nonce",
    }),
    (error: unknown) => error instanceof OidcProviderError && error.code === "id_token_invalid",
  );
});

test("Google preset keeps Google-specific endpoints and issuer aliases outside core identity", () => {
  const google = createGoogleOidcProviderConfig({
    clientId: "google-client",
    clientSecret: "google-secret",
  });
  assert.equal(google.provider, "google");
  assert.equal(google.discoveryUrl, "https://accounts.google.com/.well-known/openid-configuration");
  assert.deepEqual(google.allowedIssuers, ["https://accounts.google.com", "accounts.google.com"]);
  assert.deepEqual(google.scopes, ["openid", "profile", "email"]);
});
