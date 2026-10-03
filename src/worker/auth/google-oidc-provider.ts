import { OidcAuthProvider, type OidcAuthProviderOptions, type OidcProviderConfig } from "./oidc-provider";

export interface GoogleOidcProviderConfigInput {
  readonly clientId: string;
  readonly clientSecret?: string;
}

export const createGoogleOidcProviderConfig = (
  input: GoogleOidcProviderConfigInput,
): OidcProviderConfig => ({
  provider: "google",
  discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
  clientId: input.clientId,
  clientSecret: input.clientSecret,
  allowedIssuers: ["https://accounts.google.com", "accounts.google.com"],
  scopes: ["openid", "profile", "email"],
});

export const createGoogleOidcAuthProvider = (
  input: GoogleOidcProviderConfigInput,
  options: OidcAuthProviderOptions = {},
): OidcAuthProvider => new OidcAuthProvider(createGoogleOidcProviderConfig(input), options);
