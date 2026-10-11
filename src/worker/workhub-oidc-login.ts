import {
  createGoogleOidcAuthProvider,
  createSessionCookie,
  issueApplicationSession,
  resolveActiveUserForExternalIdentity,
  type OidcAuthProvider,
  type OidcLoginTransaction,
} from "./auth";
import { apiErrorResponse } from "./http";

const PREVIEW_ORIGIN = "https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev";
const CALLBACK_PATH = "/api/auth/oidc/callback";
const TRANSACTION_COOKIE = "__Host-workhub_oidc_transaction";
const TRANSACTION_MAX_AGE_SECONDS = 300;
const MAX_COOKIE_CHARS = 3500;

export interface FreeOidcEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
  readonly WORKHUB_FREE_AUTH_MODE?: string;
  readonly GOOGLE_OIDC_CLIENT_ID?: string;
  readonly GOOGLE_OIDC_CLIENT_SECRET?: string;
  readonly WORKHUB_OIDC_TRANSACTION_KEY?: string;
}

export const requiresPreviewExternalIdentity = (env: FreeOidcEnvironment): boolean =>
  env.RUNTIME_ENVIRONMENT === "preview" && env.WORKHUB_FREE_AUTH_MODE === "google_oidc";

export const hasPreviewGoogleOidcConfig = (env: FreeOidcEnvironment): boolean =>
  requiresPreviewExternalIdentity(env)
  && typeof env.GOOGLE_OIDC_CLIENT_ID === "string"
  && env.GOOGLE_OIDC_CLIENT_ID.trim().length > 0
  && typeof env.GOOGLE_OIDC_CLIENT_SECRET === "string"
  && env.GOOGLE_OIDC_CLIENT_SECRET.length > 0
  && typeof env.WORKHUB_OIDC_TRANSACTION_KEY === "string"
  && /^[A-Za-z0-9_-]{43}$/u.test(env.WORKHUB_OIDC_TRANSACTION_KEY);

const encode = (bytes: Uint8Array): string => {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const decode = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid_oidc_transaction_encoding");
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4, "=",
  ));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const transactionKey = async (value: string): Promise<CryptoKey> => {
  const raw = decode(value);
  if (raw.length !== 32) throw new Error("invalid_oidc_transaction_key");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const aad = new TextEncoder().encode(PREVIEW_ORIGIN + CALLBACK_PATH);
const textEncoder = new TextEncoder();

export const sealOidcTransaction = async (
  transaction: OidcLoginTransaction,
  secret: string,
): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = textEncoder.encode(JSON.stringify(transaction));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    await transactionKey(secret),
    bytes,
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return encode(combined);
};

export const unsealOidcTransaction = async (
  serialized: string,
  secret: string,
  now = Date.now(),
): Promise<OidcLoginTransaction> => {
  if (serialized.length > MAX_COOKIE_CHARS) throw new Error("invalid_oidc_transaction_length");
  const bytes = decode(serialized);
  if (bytes.length < 29) throw new Error("invalid_oidc_transaction_length");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: aad },
    await transactionKey(secret),
    bytes.slice(12),
  );
  const value: unknown = JSON.parse(new TextDecoder().decode(decrypted));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_oidc_transaction_payload");
  }
  const record = value as Record<string, unknown>;
  for (const field of ["state", "nonce", "codeVerifier", "codeChallenge"]) {
    if (typeof record[field] !== "string" || !/^[A-Za-z0-9_-]{20,200}$/u.test(record[field])) {
      throw new Error("invalid_oidc_transaction_payload");
    }
  }
  if (typeof record.createdAt !== "string") throw new Error("invalid_oidc_transaction_time");
  const issuedAt = Date.parse(record.createdAt);
  if (!Number.isFinite(issuedAt) || issuedAt > now + 5_000
    || now - issuedAt > TRANSACTION_MAX_AGE_SECONDS * 1000) {
    throw new Error("expired_oidc_transaction");
  }
  return record as unknown as OidcLoginTransaction;
};

const readTransactionCookie = (request: Request): string | null => {
  const cookie = request.headers.get("cookie");
  if (!cookie || cookie.length > 8_000) return null;
  const values = cookie.split(";").map((piece) => piece.trim()).filter((piece) =>
    piece.startsWith(TRANSACTION_COOKIE + "="));
  if (values.length !== 1) return null;
  const value = values[0].slice(TRANSACTION_COOKIE.length + 1);
  return value && value.length <= MAX_COOKIE_CHARS ? value : null;
};

const newTransactionCookie = (value: string): string =>
  TRANSACTION_COOKIE + "=" + value
  + "; Path=/; Max-Age=" + TRANSACTION_MAX_AGE_SECONDS + "; HttpOnly; Secure; SameSite=Lax";

const clearTransactionCookie = (): string =>
  TRANSACTION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";

type Provider = Pick<OidcAuthProvider, "createAuthorizationRequest" | "verify">;

export interface FreeOidcHandlerOptions {
  readonly provider?: Provider;
  readonly now?: () => number;
}

const failure = (status: number, code: string, requestId: string): Response =>
  apiErrorResponse({ status, code, message: "External sign-in unavailable" }, requestId);

export const handleWorkhubFreeOidc = async (
  request: Request,
  env: FreeOidcEnvironment,
  requestId: string,
  options: FreeOidcHandlerOptions = {},
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== "/api/auth/oidc/start" && url.pathname !== CALLBACK_PATH) return null;
  if (request.method !== "GET") return failure(405, "method_not_allowed", requestId);
  if (url.origin !== PREVIEW_ORIGIN || !requiresPreviewExternalIdentity(env)) {
    return failure(404, "external_sign_in_disabled", requestId);
  }
  if (!hasPreviewGoogleOidcConfig(env)) {
    return failure(503, "external_sign_in_not_configured", requestId);
  }

  const provider = options.provider ?? createGoogleOidcAuthProvider({
    clientId: env.GOOGLE_OIDC_CLIENT_ID as string,
    clientSecret: env.GOOGLE_OIDC_CLIENT_SECRET,
  });
  const key = env.WORKHUB_OIDC_TRANSACTION_KEY as string;
  const redirectUri = PREVIEW_ORIGIN + CALLBACK_PATH;

  if (url.pathname === "/api/auth/oidc/start") {
    try {
      const login = await provider.createAuthorizationRequest(redirectUri);
      const sealed = await sealOidcTransaction(login.transaction, key);
      const headers = new Headers({
        location: login.url,
        "cache-control": "no-store",
      });
      headers.append("set-cookie", newTransactionCookie(sealed));
      return new Response(null, { status: 302, headers });
    } catch {
      return failure(503, "external_sign_in_dependency_unavailable", requestId);
    }
  }

  const clear = (response: Response) => {
    response.headers.append("set-cookie", clearTransactionCookie());
    return response;
  };

  const returnedState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const encrypted = readTransactionCookie(request);
  if (!returnedState || returnedState.length > 200
    || !code || code.length > 2_048 || !encrypted) {
    return clear(failure(401, "external_sign_in_invalid_callback", requestId));
  }

  try {
    const tx = await unsealOidcTransaction(encrypted, key, options.now?.() ?? Date.now());
    if (tx.state !== returnedState) {
      return clear(failure(401, "external_sign_in_state_mismatch", requestId));
    }
    const identity = await provider.verify({
      code,
      returnedState,
      expectedState: tx.state,
      redirectUri,
      codeVerifier: tx.codeVerifier,
      expectedNonce: tx.nonce,
    });
    const user = await resolveActiveUserForExternalIdentity(env.DB, identity);
    if (!user) return clear(failure(403, "external_identity_not_linked", requestId));
    const session = await issueApplicationSession(env.DB, user.id);
    const headers = new Headers({ location: "/", "cache-control": "no-store" });
    headers.append("set-cookie", createSessionCookie(session.token));
    headers.append("set-cookie", clearTransactionCookie());
    return new Response(null, { status: 303, headers });
  } catch {
    return clear(failure(401, "external_sign_in_verification_failed", requestId));
  }
};
