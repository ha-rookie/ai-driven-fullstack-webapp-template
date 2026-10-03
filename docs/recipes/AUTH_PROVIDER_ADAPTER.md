# Recipe: Auth Provider Adapter

## Inputs
- chosen Identity Provider and protocol
- external subject identifier contract
- user provisioning / linking policy
- session lifetime / revoke expectation
- callback / origin requirements per environment

Read `../AUTH_DESIGN.md` and `../instructions/authentication-session.md` first.
For OIDC / OAuth, also read `../AUTH_OIDC.md`.

## Stop Conditions
Stop when:
- provider is still undecided
- account linking rules are ambiguous
- provider secret handling is not defined
- callback origin differs across environments but mapping is unknown
- the change would bypass the application session and expose provider token semantics to the rest of the app
- OIDC transactionの`state` / `nonce` / PKCE `codeVerifier`をどこへ短時間保持するか未決定

## Steps
1. Keep external identity resolution behind a provider adapter
2. OIDCではAuthorization Code + PKCE（S256）を使い、login開始時に`state` / `nonce` / `codeVerifier`を生成する
3. callbackでは`state`をtoken exchangeより先に検証する
4. ID Tokenはdecodeだけで信用せず、JWKS署名・issuer・audience・expiry・nonce・subjectを検証する
5. Provider固有claimを`VerifiedExternalIdentity`へ正規化し、Providerの`sub`を外部Identity keyとして使う
6. Map provider identity to the internal user model according to Project policy
7. Issue the existing opaque application session rather than reusing provider tokens as app sessions
8. Preserve revoke / logout / rotation semantics
9. Keep provider configuration environment-specific and secrets outside Repository content
10. Preview / ProductionのClient ID / Secret / Redirect URIを分離する
11. Add negative-path tests for invalid state, nonce, signature, issuer, audience and expiry

## Google Reference Adapter
#35ではGoogleをReference Providerとして扱う。

- `createGoogleOidcAuthProvider()`を利用できる
- Discovery URLはGoogle公式OpenID Configurationを使う
- Google固有の`email`等をCore user keyへ固定しない
- Identity keyは`provider=google + sub`
- Google Cloud上のOAuth Client作成や実loginはLocal CIとは分け、Human-triggered Preview evidenceとして扱う

## Validation
- unit tests for provider mapping / callback validation
- PKCE authorization URL
- state mismatch時にprovider networkへ進まないこと
- JWKS署名 / issuer / audience / expiry / nonce validation
- existing session rotation and revocation tests
- `npm run validate:local`
- browser/auth integration evidence where the adapter has a Local test double

Remote provider login is separate evidence and may require a Human-triggered environment check.

## Evidence
Record:
- provider/protocol selected by the Project
- external-to-internal identity mapping rule
- secret/config boundary
- transaction state storage boundary
- Local / CI evidence
- Preview provider evidence when explicitly run

## Do Not
- hard-code one provider into Core session semantics
- persist access tokens unless the Project explicitly requires it and defines encryption/retention
- log provider tokens, authorization codes, PKCE verifier, state, nonce or raw identity payloads
- treat successful redirect rendering as proof of correct account linking
- silently create users if Project provisioning policy is undecided
- link an existing user only because email strings happen to match
- reuse Preview OAuth credentials in Production
