import type { AuthProvider } from "./auth-provider";
import type { VerifiedExternalIdentity } from "./types";

const DEFAULT_SCOPES = ["openid", "profile", "email"] as const;
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

export interface OidcProviderConfig {
  readonly provider: string;
  readonly discoveryUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly allowedIssuers: readonly string[];
  readonly scopes?: readonly string[];
  readonly clockSkewSeconds?: number;
}

export interface OidcLoginTransaction {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly createdAt: string;
}

export interface OidcAuthorizationCodeCredential {
  readonly code: string;
  readonly returnedState: string;
  readonly expectedState: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly expectedNonce: string;
}

export interface OidcAuthorizationRequest {
  readonly url: string;
  readonly transaction: OidcLoginTransaction;
}

interface OidcDiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

interface OidcTokenResponse {
  readonly id_token?: unknown;
}

interface JwtHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
}

interface JwtClaims {
  readonly iss?: unknown;
  readonly sub?: unknown;
  readonly aud?: unknown;
  readonly azp?: unknown;
  readonly exp?: unknown;
  readonly iat?: unknown;
  readonly nonce?: unknown;
  readonly name?: unknown;
}

export class OidcProviderError extends Error {
  constructor(
    public readonly code:
      | "configuration_invalid"
      | "state_mismatch"
      | "discovery_failed"
      | "authorization_code_exchange_failed"
      | "token_response_invalid"
      | "id_token_invalid",
    message: string,
  ) {
    super(message);
    this.name = "OidcProviderError";
  }
}

export interface OidcAuthProviderOptions {
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
  readonly randomBytes?: (length: number) => Uint8Array;
}

const textEncoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const parseJsonSegment = <T>(value: string): T => {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(value))) as T;
  } catch {
    throw new OidcProviderError("id_token_invalid", "OIDC ID token is malformed");
  }
};

const requireHttpsUrl = (value: string, field: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcProviderError("configuration_invalid", `${field} must be a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new OidcProviderError("configuration_invalid", `${field} must use HTTPS`);
  }
  return url;
};

const defaultRandomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

const sha256 = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));

export const createOidcLoginTransaction = async (
  options: Pick<OidcAuthProviderOptions, "now" | "randomBytes"> = {},
): Promise<OidcLoginTransaction> => {
  const randomBytes = options.randomBytes ?? defaultRandomBytes;
  const codeVerifier = toBase64Url(randomBytes(32));
  return {
    state: toBase64Url(randomBytes(32)),
    nonce: toBase64Url(randomBytes(32)),
    codeVerifier,
    codeChallenge: toBase64Url(await sha256(codeVerifier)),
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  };
};

export const validateOidcCallbackState = (expected: string, returned: string): void => {
  if (!expected || !returned || expected !== returned) {
    throw new OidcProviderError("state_mismatch", "OIDC callback state did not match");
  }
};

const validateConfig = (config: OidcProviderConfig): void => {
  if (!config.provider.trim() || !config.clientId.trim()) {
    throw new OidcProviderError("configuration_invalid", "OIDC provider and clientId are required");
  }
  requireHttpsUrl(config.discoveryUrl, "discoveryUrl");
  if (config.allowedIssuers.length === 0) {
    throw new OidcProviderError("configuration_invalid", "At least one allowed issuer is required");
  }
  for (const issuer of config.allowedIssuers) requireHttpsUrl(issuer, "allowed issuer");
};

const readJsonResponse = async <T>(response: Response, code: OidcProviderError["code"]): Promise<T> => {
  try {
    return await response.json() as T;
  } catch {
    throw new OidcProviderError(code, "OIDC provider returned invalid JSON");
  }
};

const validateDiscovery = (
  config: OidcProviderConfig,
  document: OidcDiscoveryDocument,
): OidcDiscoveryDocument => {
  if (!config.allowedIssuers.includes(document.issuer)) {
    throw new OidcProviderError("discovery_failed", "OIDC discovery issuer is not allowed");
  }
  requireHttpsUrl(document.authorization_endpoint, "authorization_endpoint");
  requireHttpsUrl(document.token_endpoint, "token_endpoint");
  requireHttpsUrl(document.jwks_uri, "jwks_uri");
  return document;
};

const validateAudience = (claims: JwtClaims, clientId: string): void => {
  if (typeof claims.aud === "string") {
    if (claims.aud !== clientId) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token audience is invalid");
    }
    return;
  }
  if (Array.isArray(claims.aud) && claims.aud.every((value) => typeof value === "string")) {
    if (!claims.aud.includes(clientId)) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token audience is invalid");
    }
    if (claims.aud.length > 1 && claims.azp !== clientId) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token authorized party is invalid");
    }
    return;
  }
  throw new OidcProviderError("id_token_invalid", "OIDC ID token audience is missing");
};

export class OidcAuthProvider implements AuthProvider<OidcAuthorizationCodeCredential> {
  readonly provider: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private discoveryPromise?: Promise<OidcDiscoveryDocument>;

  constructor(
    private readonly config: OidcProviderConfig,
    options: OidcAuthProviderOptions = {},
  ) {
    validateConfig(config);
    this.provider = config.provider;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async discovery(): Promise<OidcDiscoveryDocument> {
    if (!this.discoveryPromise) {
      this.discoveryPromise = (async () => {
        let response: Response;
        try {
          response = await this.fetcher(this.config.discoveryUrl, {
            headers: { accept: "application/json" },
          });
        } catch {
          throw new OidcProviderError("discovery_failed", "OIDC discovery request failed");
        }
        if (!response.ok) {
          throw new OidcProviderError("discovery_failed", "OIDC discovery request failed");
        }
        return validateDiscovery(
          this.config,
          await readJsonResponse<OidcDiscoveryDocument>(response, "discovery_failed"),
        );
      })();
    }
    return this.discoveryPromise;
  }

  async createAuthorizationRequest(
    redirectUri: string,
    options: {
      readonly loginHint?: string;
      readonly transaction?: OidcLoginTransaction;
    } = {},
  ): Promise<OidcAuthorizationRequest> {
    requireHttpsUrl(redirectUri, "redirectUri");
    const transaction = options.transaction ?? await createOidcLoginTransaction();
    const discovery = await this.discovery();
    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", this.config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", (this.config.scopes ?? DEFAULT_SCOPES).join(" "));
    authorizationUrl.searchParams.set("state", transaction.state);
    authorizationUrl.searchParams.set("nonce", transaction.nonce);
    authorizationUrl.searchParams.set("code_challenge", transaction.codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    if (options.loginHint?.trim()) authorizationUrl.searchParams.set("login_hint", options.loginHint.trim());
    return { url: authorizationUrl.toString(), transaction };
  }

  async verify(credential: OidcAuthorizationCodeCredential): Promise<VerifiedExternalIdentity> {
    validateOidcCallbackState(credential.expectedState, credential.returnedState);
    requireHttpsUrl(credential.redirectUri, "redirectUri");
    if (!credential.code.trim() || !credential.codeVerifier.trim() || !credential.expectedNonce.trim()) {
      throw new OidcProviderError("token_response_invalid", "OIDC callback credential is incomplete");
    }

    const discovery = await this.discovery();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: credential.code,
      client_id: this.config.clientId,
      redirect_uri: credential.redirectUri,
      code_verifier: credential.codeVerifier,
    });
    if (this.config.clientSecret) body.set("client_secret", this.config.clientSecret);

    let tokenResponse: Response;
    try {
      tokenResponse = await this.fetcher(discovery.token_endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      });
    } catch {
      throw new OidcProviderError(
        "authorization_code_exchange_failed",
        "OIDC authorization code exchange failed",
      );
    }
    if (!tokenResponse.ok) {
      throw new OidcProviderError(
        "authorization_code_exchange_failed",
        "OIDC authorization code exchange failed",
      );
    }

    const token = await readJsonResponse<OidcTokenResponse>(tokenResponse, "token_response_invalid");
    if (typeof token.id_token !== "string") {
      throw new OidcProviderError("token_response_invalid", "OIDC token response did not include an ID token");
    }

    const claims = await this.verifyIdToken(token.id_token, discovery, credential.expectedNonce);
    return {
      provider: this.provider,
      subject: claims.sub as string,
      displayName: typeof claims.name === "string" ? claims.name : null,
    };
  }

  private async verifyIdToken(
    idToken: string,
    discovery: OidcDiscoveryDocument,
    expectedNonce: string,
  ): Promise<JwtClaims> {
    const segments = idToken.split(".");
    if (segments.length !== 3) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token is malformed");
    }
    const [encodedHeader, encodedClaims, encodedSignature] = segments;
    const header = parseJsonSegment<JwtHeader>(encodedHeader);
    const claims = parseJsonSegment<JwtClaims>(encodedClaims);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token signing algorithm is invalid");
    }

    let jwksResponse: Response;
    try {
      jwksResponse = await this.fetcher(discovery.jwks_uri, {
        headers: { accept: "application/json" },
      });
    } catch {
      throw new OidcProviderError("id_token_invalid", "OIDC signing keys are unavailable");
    }
    if (!jwksResponse.ok) {
      throw new OidcProviderError("id_token_invalid", "OIDC signing keys are unavailable");
    }
    const jwks = await readJsonResponse<{ readonly keys?: unknown }>(jwksResponse, "id_token_invalid");
    if (!Array.isArray(jwks.keys)) {
      throw new OidcProviderError("id_token_invalid", "OIDC signing keys are invalid");
    }
    const jwk = jwks.keys.find((candidate): candidate is JsonWebKey & { kid: string } => {
      if (!candidate || typeof candidate !== "object") return false;
      const record = candidate as Record<string, unknown>;
      return record.kid === header.kid && record.kty === "RSA" &&
        (record.alg === undefined || record.alg === "RS256") &&
        (record.use === undefined || record.use === "sig");
    });
    if (!jwk) {
      throw new OidcProviderError("id_token_invalid", "OIDC signing key was not found");
    }

    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
    } catch {
      throw new OidcProviderError("id_token_invalid", "OIDC signing key is invalid");
    }
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromBase64Url(encodedSignature),
      textEncoder.encode(`${encodedHeader}.${encodedClaims}`),
    );
    if (!verified) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token signature is invalid");
    }

    if (typeof claims.iss !== "string" || !this.config.allowedIssuers.includes(claims.iss)) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token issuer is invalid");
    }
    validateAudience(claims, this.config.clientId);
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const skew = this.config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
    if (typeof claims.exp !== "number" || claims.exp <= nowSeconds - skew) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token is expired");
    }
    if (typeof claims.iat !== "number" || claims.iat > nowSeconds + skew) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token issued-at time is invalid");
    }
    if (typeof claims.nonce !== "string" || claims.nonce !== expectedNonce) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token nonce is invalid");
    }
    if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) {
      throw new OidcProviderError("id_token_invalid", "OIDC ID token subject is invalid");
    }
    return claims;
  }
}
