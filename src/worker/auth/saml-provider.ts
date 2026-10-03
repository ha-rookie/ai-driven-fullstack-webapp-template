import type { AuthProvider } from "./auth-provider";
import type { VerifiedExternalIdentity } from "./types";
import {
  systemClock,
  type Clock,
  type RuntimeEnvironment,
} from "../../shared/runtime";

const SAML_PROTOCOL = "urn:oasis:names:tc:SAML:2.0:protocol";
const SAML_ASSERTION = "urn:oasis:names:tc:SAML:2.0:assertion";
const HTTP_POST_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";
const PERSISTENT_NAME_ID = "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent";
const TRANSIENT_NAME_ID = "urn:oasis:names:tc:SAML:2.0:nameid-format:transient";
const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_REQUEST_TTL_SECONDS = 10 * 60;
const DEFAULT_MAX_RESPONSE_AGE_SECONDS = 5 * 60;
const MAX_SAML_RESPONSE_CHARS = 1_500_000;
const MAX_IDENTIFIER_LENGTH = 2048;
const DEFAULT_REPLAY_PURGE_BATCH = 500;
const MAX_REPLAY_PURGE_BATCH = 2000;

export interface SamlSubjectFromNameId {
  readonly source: "nameId";
  readonly allowTransient?: boolean;
}

export interface SamlSubjectFromAttribute {
  readonly source: "attribute";
  readonly name: string;
}

export type SamlSubjectMapping = SamlSubjectFromNameId | SamlSubjectFromAttribute;
export type SamlSignedElement = "response" | "assertion";

export interface SamlProviderConfig {
  readonly provider: string;
  readonly idpEntityId: string;
  readonly idpSsoUrl: string;
  readonly spEntityId: string;
  readonly acsUrl: string;
  readonly subjectMapping: SamlSubjectMapping;
  readonly displayNameAttribute?: string;
  readonly acceptedSignedElements?: readonly SamlSignedElement[];
  readonly clockSkewSeconds?: number;
  readonly requestTtlSeconds?: number;
  readonly maxResponseAgeSeconds?: number;
}

export interface SamlLoginTransaction {
  readonly requestId: string;
  readonly relayState: string;
  readonly createdAt: string;
}

export interface SamlAuthorizationRequest {
  readonly method: "POST";
  readonly destination: string;
  readonly fields: Readonly<{
    SAMLRequest: string;
    RelayState: string;
  }>;
  readonly transaction: SamlLoginTransaction;
}

export interface SamlResponseCredential {
  readonly samlResponse: string;
  readonly returnedRelayState: string;
  readonly expectedRelayState: string;
  readonly expectedRequestId: string;
  readonly expectedRequestCreatedAt: string;
}

export interface VerifiedSamlAssertion {
  readonly signatureValidated: true;
  readonly signedElement: SamlSignedElement;
  readonly status: "success";
  readonly issuer: string;
  readonly responseId: string;
  readonly assertionId: string;
  readonly inResponseTo: string;
  readonly destination: string;
  readonly recipient: string;
  readonly audiences: readonly string[];
  readonly issuedAt: string;
  readonly notBefore?: string;
  readonly notOnOrAfter: string;
  readonly nameId?: string;
  readonly nameIdFormat?: string;
  readonly attributes: Readonly<Record<string, readonly string[]>>;
}

export interface SamlAssertionVerifierInput {
  readonly samlResponse: string;
  readonly expectedIdpEntityId: string;
}

/**
 * The implementation MUST validate XMLDSIG before returning.
 * It must reject duplicate XML IDs / signature-wrapping ambiguity and return
 * fields only from the signed trust path. Raw XML is intentionally kept out of
 * provider-neutral session semantics.
 */
export interface SamlAssertionVerifier {
  verifySignedResponse(input: SamlAssertionVerifierInput): Promise<VerifiedSamlAssertion>;
}

export interface SamlReplayClaim {
  readonly provider: string;
  readonly assertionId: string;
  readonly expiresAt: string;
}

export interface SamlReplayStore {
  consume(claim: SamlReplayClaim): Promise<boolean>;
}

export class SamlProviderError extends Error {
  constructor(
    public readonly code:
      | "configuration_invalid"
      | "transaction_mismatch"
      | "transaction_expired"
      | "response_too_large"
      | "verification_failed"
      | "assertion_invalid"
      | "assertion_expired"
      | "assertion_replayed"
      | "identity_mapping_invalid",
    message: string,
  ) {
    super(message);
    this.name = "SamlProviderError";
  }
}

export interface SamlAuthProviderOptions {
  readonly verifier: SamlAssertionVerifier;
  readonly replayStore: SamlReplayStore;
  readonly clock?: Clock;
}

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) return true;
  }
  return false;
};

const assertBoundedIdentifier = (value: string, field: string): void => {
  if (
    !value.trim()
    || value.length > MAX_IDENTIFIER_LENGTH
    || containsControlCharacter(value)
  ) {
    throw new SamlProviderError("configuration_invalid", `${field} must be a bounded non-control string`);
  }
};

const requireHttpsUrl = (value: string, field: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SamlProviderError("configuration_invalid", `${field} must be a valid URL`);
  }
  if (url.protocol !== "https:") {
    throw new SamlProviderError("configuration_invalid", `${field} must use HTTPS`);
  }
  return url;
};

const assertPositiveInteger = (value: number, field: string, maximum = 24 * 60 * 60): void => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new SamlProviderError("configuration_invalid", `${field} is outside the supported range`);
  }
};

const parseTimestamp = (value: string, field: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new SamlProviderError("assertion_invalid", `${field} is not a valid timestamp`);
  }
  return parsed;
};

const validateConfig = (config: SamlProviderConfig): void => {
  assertBoundedIdentifier(config.provider, "provider");
  assertBoundedIdentifier(config.idpEntityId, "idpEntityId");
  assertBoundedIdentifier(config.spEntityId, "spEntityId");
  requireHttpsUrl(config.idpSsoUrl, "idpSsoUrl");
  requireHttpsUrl(config.acsUrl, "acsUrl");

  if (config.subjectMapping.source === "attribute") {
    assertBoundedIdentifier(config.subjectMapping.name, "subjectMapping.name");
  }
  if (config.displayNameAttribute !== undefined) {
    assertBoundedIdentifier(config.displayNameAttribute, "displayNameAttribute");
  }

  const accepted = config.acceptedSignedElements ?? ["assertion"];
  if (accepted.length === 0 || accepted.some((value) => value !== "assertion" && value !== "response")) {
    throw new SamlProviderError("configuration_invalid", "acceptedSignedElements must contain supported values");
  }

  assertPositiveInteger(config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS, "clockSkewSeconds", 10 * 60);
  assertPositiveInteger(config.requestTtlSeconds ?? DEFAULT_REQUEST_TTL_SECONDS, "requestTtlSeconds");
  assertPositiveInteger(config.maxResponseAgeSeconds ?? DEFAULT_MAX_RESPONSE_AGE_SECONDS, "maxResponseAgeSeconds");
};

const defaultRandomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const encodeUtf8Base64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const escapeXml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

export const createSamlLoginTransaction = (
  options: {
    readonly now?: () => Date;
    readonly randomBytes?: (length: number) => Uint8Array;
  } = {},
): SamlLoginTransaction => {
  const randomBytes = options.randomBytes ?? defaultRandomBytes;
  return {
    requestId: `_${toBase64Url(randomBytes(24))}`,
    relayState: toBase64Url(randomBytes(24)),
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  };
};

const buildAuthnRequestXml = (config: SamlProviderConfig, transaction: SamlLoginTransaction): string =>
  `<?xml version="1.0" encoding="UTF-8"?>`
  + `<samlp:AuthnRequest xmlns:samlp="${SAML_PROTOCOL}" xmlns:saml="${SAML_ASSERTION}"`
  + ` ID="${escapeXml(transaction.requestId)}" Version="2.0" IssueInstant="${escapeXml(transaction.createdAt)}"`
  + ` Destination="${escapeXml(config.idpSsoUrl)}" AssertionConsumerServiceURL="${escapeXml(config.acsUrl)}"`
  + ` ProtocolBinding="${HTTP_POST_BINDING}">`
  + `<saml:Issuer>${escapeXml(config.spEntityId)}</saml:Issuer>`
  + `<samlp:NameIDPolicy AllowCreate="true"/>`
  + `</samlp:AuthnRequest>`;

export const createSamlSpMetadata = (config: SamlProviderConfig): string => {
  validateConfig(config);
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(config.spEntityId)}">`
    + `<md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="${SAML_PROTOCOL}">`
    + `<md:NameIDFormat>${PERSISTENT_NAME_ID}</md:NameIDFormat>`
    + `<md:AssertionConsumerService Binding="${HTTP_POST_BINDING}" Location="${escapeXml(config.acsUrl)}" index="0" isDefault="true"/>`
    + `</md:SPSSODescriptor></md:EntityDescriptor>`;
};

const validateLoginTransaction = (
  credential: SamlResponseCredential,
  nowMs: number,
  requestTtlSeconds: number,
): void => {
  if (
    !credential.expectedRequestId
    || credential.returnedRelayState !== credential.expectedRelayState
    || !credential.expectedRelayState
  ) {
    throw new SamlProviderError("transaction_mismatch", "SAML login transaction did not match");
  }
  const createdAt = Date.parse(credential.expectedRequestCreatedAt);
  if (!Number.isFinite(createdAt) || createdAt > nowMs || nowMs - createdAt > requestTtlSeconds * 1000) {
    throw new SamlProviderError("transaction_expired", "SAML login transaction expired");
  }
  if (!credential.samlResponse || credential.samlResponse.length > MAX_SAML_RESPONSE_CHARS) {
    throw new SamlProviderError("response_too_large", "SAML response is empty or exceeds the supported size");
  }
};

const readSingleAttribute = (
  attributes: Readonly<Record<string, readonly string[]>>,
  name: string,
): string | null => {
  const values = attributes[name];
  if (!values || values.length !== 1 || typeof values[0] !== "string" || !values[0].trim()) return null;
  return values[0];
};

const mapSubject = (config: SamlProviderConfig, assertion: VerifiedSamlAssertion): string => {
  let subject: string | null = null;

  if (config.subjectMapping.source === "nameId") {
    if (
      assertion.nameIdFormat === TRANSIENT_NAME_ID
      && config.subjectMapping.allowTransient !== true
    ) {
      throw new SamlProviderError("identity_mapping_invalid", "Transient SAML NameID is not accepted as a stable identity key");
    }
    subject = assertion.nameId?.trim() || null;
  } else {
    subject = readSingleAttribute(assertion.attributes, config.subjectMapping.name)?.trim() || null;
  }

  if (!subject || subject.length > MAX_IDENTIFIER_LENGTH || containsControlCharacter(subject)) {
    throw new SamlProviderError("identity_mapping_invalid", "SAML subject mapping did not produce one stable identifier");
  }
  return subject;
};

const mapDisplayName = (config: SamlProviderConfig, assertion: VerifiedSamlAssertion): string | null => {
  if (!config.displayNameAttribute) return null;
  const value = readSingleAttribute(assertion.attributes, config.displayNameAttribute);
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || containsControlCharacter(value)) return null;
  return value;
};

export class InMemorySamlReplayStore implements SamlReplayStore {
  private readonly claims = new Map<string, number>();

  constructor(private readonly clock: Clock = systemClock) {}

  async consume(claim: SamlReplayClaim): Promise<boolean> {
    const nowMs = this.clock.now().getTime();
    for (const [key, expiresAt] of this.claims) {
      if (expiresAt <= nowMs) this.claims.delete(key);
    }
    const expiresAt = parseTimestamp(claim.expiresAt, "expiresAt");
    if (expiresAt <= nowMs) return false;
    const key = `${claim.provider}\u0000${claim.assertionId}`;
    if (this.claims.has(key)) return false;
    this.claims.set(key, expiresAt);
    return true;
  }
}

export interface D1SamlReplayStoreOptions {
  readonly db: D1Database;
  readonly environment: RuntimeEnvironment;
  readonly clock?: Clock;
}

export class D1SamlReplayStore implements SamlReplayStore {
  private readonly clock: Clock;

  constructor(private readonly options: D1SamlReplayStoreOptions) {
    this.clock = options.clock ?? systemClock;
  }

  async consume(claim: SamlReplayClaim): Promise<boolean> {
    assertBoundedIdentifier(claim.provider, "provider");
    assertBoundedIdentifier(claim.assertionId, "assertionId");
    const now = this.clock.now().toISOString();
    const expiresAtMs = parseTimestamp(claim.expiresAt, "expiresAt");
    if (expiresAtMs <= this.clock.now().getTime()) return false;

    await this.options.db
      .prepare(`
        DELETE FROM saml_assertion_replays
        WHERE environment = ? AND provider = ? AND assertion_id = ? AND expires_at <= ?
      `)
      .bind(this.options.environment, claim.provider, claim.assertionId, now)
      .run();

    const result = await this.options.db
      .prepare(`
        INSERT OR IGNORE INTO saml_assertion_replays (
          environment, provider, assertion_id, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .bind(this.options.environment, claim.provider, claim.assertionId, claim.expiresAt, now)
      .run();

    return (result.meta.changes ?? 0) === 1;
  }

  async purgeExpired(batchSize = DEFAULT_REPLAY_PURGE_BATCH): Promise<number> {
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0 || batchSize > MAX_REPLAY_PURGE_BATCH) {
      throw new RangeError(`batchSize must be between 1 and ${MAX_REPLAY_PURGE_BATCH}`);
    }
    const result = await this.options.db
      .prepare(`
        DELETE FROM saml_assertion_replays
        WHERE rowid IN (
          SELECT rowid FROM saml_assertion_replays
          WHERE environment = ? AND expires_at <= ?
          ORDER BY expires_at ASC
          LIMIT ?
        )
      `)
      .bind(this.options.environment, this.clock.now().toISOString(), batchSize)
      .run();
    return result.meta.changes ?? 0;
  }
}

export class SamlAuthProvider implements AuthProvider<SamlResponseCredential> {
  readonly provider: string;
  private readonly clock: Clock;

  constructor(
    private readonly config: SamlProviderConfig,
    private readonly options: SamlAuthProviderOptions,
  ) {
    validateConfig(config);
    this.provider = config.provider;
    this.clock = options.clock ?? systemClock;
  }

  createAuthorizationRequest(transaction = createSamlLoginTransaction()): SamlAuthorizationRequest {
    const requestXml = buildAuthnRequestXml(this.config, transaction);
    return {
      method: "POST",
      destination: this.config.idpSsoUrl,
      fields: {
        SAMLRequest: encodeUtf8Base64(requestXml),
        RelayState: transaction.relayState,
      },
      transaction,
    };
  }

  createSpMetadata(): string {
    return createSamlSpMetadata(this.config);
  }

  async verify(credential: SamlResponseCredential): Promise<VerifiedExternalIdentity> {
    const nowMs = this.clock.now().getTime();
    validateLoginTransaction(
      credential,
      nowMs,
      this.config.requestTtlSeconds ?? DEFAULT_REQUEST_TTL_SECONDS,
    );

    let assertion: VerifiedSamlAssertion;
    try {
      assertion = await this.options.verifier.verifySignedResponse({
        samlResponse: credential.samlResponse,
        expectedIdpEntityId: this.config.idpEntityId,
      });
    } catch {
      throw new SamlProviderError("verification_failed", "SAML response signature verification failed");
    }

    const accepted = this.config.acceptedSignedElements ?? ["assertion"];
    if (
      assertion.signatureValidated !== true
      || assertion.status !== "success"
      || !accepted.includes(assertion.signedElement)
      || assertion.issuer !== this.config.idpEntityId
      || assertion.inResponseTo !== credential.expectedRequestId
      || assertion.destination !== this.config.acsUrl
      || assertion.recipient !== this.config.acsUrl
      || !assertion.audiences.includes(this.config.spEntityId)
    ) {
      throw new SamlProviderError("assertion_invalid", "SAML assertion did not match the expected service provider context");
    }

    assertBoundedIdentifier(assertion.responseId, "responseId");
    assertBoundedIdentifier(assertion.assertionId, "assertionId");

    const skewMs = (this.config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS) * 1000;
    const maxAgeMs = (this.config.maxResponseAgeSeconds ?? DEFAULT_MAX_RESPONSE_AGE_SECONDS) * 1000;
    const issuedAt = parseTimestamp(assertion.issuedAt, "issuedAt");
    const notOnOrAfter = parseTimestamp(assertion.notOnOrAfter, "notOnOrAfter");
    if (issuedAt > nowMs + skewMs || issuedAt < nowMs - maxAgeMs - skewMs) {
      throw new SamlProviderError("assertion_invalid", "SAML assertion issue time is outside the accepted window");
    }
    if (assertion.notBefore !== undefined) {
      const notBefore = parseTimestamp(assertion.notBefore, "notBefore");
      if (nowMs + skewMs < notBefore) {
        throw new SamlProviderError("assertion_invalid", "SAML assertion is not active yet");
      }
    }
    if (nowMs - skewMs >= notOnOrAfter) {
      throw new SamlProviderError("assertion_expired", "SAML assertion expired");
    }

    const firstUse = await this.options.replayStore.consume({
      provider: this.provider,
      assertionId: assertion.assertionId,
      expiresAt: assertion.notOnOrAfter,
    });
    if (!firstUse) {
      throw new SamlProviderError("assertion_replayed", "SAML assertion was already consumed");
    }

    return {
      provider: this.provider,
      subject: mapSubject(this.config, assertion),
      displayName: mapDisplayName(this.config, assertion),
    };
  }
}
