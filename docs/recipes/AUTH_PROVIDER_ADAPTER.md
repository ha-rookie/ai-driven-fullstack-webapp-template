# Recipe: Auth Provider Adapter

## Inputs
- chosen Identity Provider and protocol
- external subject identifier contract
- user provisioning / linking policy
- session lifetime / revoke expectation
- callback / origin requirements per environment

Read `../AUTH_DESIGN.md` and `../instructions/authentication-session.md` first.
For OIDC / OAuth, also read `../AUTH_OIDC.md`.
For SAML 2.0, also read `../AUTH_SAML.md`.

## Stop Conditions
Stop when:
- provider is still undecided
- account linking rules are ambiguous
- provider secret handling is not defined
- callback origin differs across environments but mapping is unknown
- the change would bypass the application session and expose provider token semantics to the rest of the app
- OIDC transactionの`state` / `nonce` / PKCE `codeVerifier`をどこへ短時間保持するか未決定
- SAMLのXMLDSIG verifier / IdP signing certificate trust boundaryが未決定
- SAMLのReplay StoreをProductionで永続化する方式が未決定

## Steps
1. Keep external identity resolution behind a provider adapter
2. OIDCではAuthorization Code + PKCE（S256）を使い、login開始時に`state` / `nonce` / `codeVerifier`を生成する
3. OIDC callbackでは`state`をtoken exchangeより先に検証する
4. OIDC ID Tokenはdecodeだけで信用せず、JWKS署名・issuer・audience・expiry・nonce・subjectを検証する
5. SAMLではopaqueな`RelayState`と`InResponseTo`をlogin transactionへ紐付ける
6. SAML ResponseはXMLを読む前提ではなく、XMLDSIGとsignature wrapping対策を実装した`SamlAssertionVerifier`を必須注入する
7. SAML verifier後もAudience / Destination / Recipient / InResponseTo / time window / Assertion replayをCoreで再確認する
8. Provider固有claim / SAML attributeを`VerifiedExternalIdentity`へ正規化する
9. OIDCは`provider + sub`、SAMLはpersistent NameIDまたはProjectが明示したstable attributeを外部Identity keyとして使う
10. Map provider identity to the internal user model according to Project policy
11. Issue the existing opaque application session rather than reusing provider tokens / raw assertions as app sessions
12. Preserve revoke / logout / rotation semantics
13. Keep provider configuration environment-specific and secrets outside Repository content
14. Preview / ProductionのClient ID / Secret / Redirect URI / Entity ID / ACS URLを分離する
15. Add negative-path tests for transaction mismatch, signature failure, issuer/audience/recipient, expiry and replay

## Google Reference Adapter
#35ではGoogleをReference Providerとして扱う。

- `createGoogleOidcAuthProvider()`を利用できる
- Discovery URLはGoogle公式OpenID Configurationを使う
- Google固有の`email`等をCore user keyへ固定しない
- Identity keyは`provider=google + sub`
- Google Cloud上のOAuth Client作成や実loginはLocal CIとは分け、Human-triggered Preview evidenceとして扱う

## SAML Enterprise SSO Foundation
#36ではSAML 2.0固有のtransaction / replay / identity mappingを共通化する。

- `SamlAuthProvider`は`SamlAssertionVerifier`を必須とする
- XML署名検証をTemplate Coreで手書きしない
- verifierはduplicate XML ID / XML Signature Wrappingをfail closedで拒否する
- `0018_saml_assertion_replays.sql`でAssertion ID replayを環境別に拒否する
- transient NameIDは既定でstable identity keyとして使わない
- `xmldsigjs`等の具体libraryはWorkers runtime / DOM / XPath compatibilityをProjectで実証してから採用する
- IdP metadata / certificate登録や実loginはHuman-triggered Preview evidenceとして扱う

## Validation
- unit tests for provider mapping / callback validation
- OIDC PKCE authorization URL
- OIDC state mismatch時にprovider networkへ進まないこと
- OIDC JWKS署名 / issuer / audience / expiry / nonce validation
- SAML AuthnRequest / SP Metadata contract
- SAML RelayState mismatch時にverifierへ進まないこと
- SAML Audience / Recipient / InResponseTo / expiry / replay validation
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
- SAML verifier / certificate trust boundary when applicable
- Local / CI evidence
- Preview provider evidence when explicitly run

## Do Not
- hard-code one provider into Core session semantics
- persist access tokens unless the Project explicitly requires it and defines encryption/retention
- log provider tokens, authorization codes, PKCE verifier, state, nonce, SAMLResponse, raw assertion or raw identity payloads
- treat successful redirect rendering as proof of correct account linking
- silently create users if Project provisioning policy is undecided
- link an existing user only because email strings happen to match
- reuse Preview OAuth credentials / SAML metadata / signing certificate assumptions in Production
- parse a SAMLResponse and create a user before XMLDSIG verification succeeds
- use InMemory replay protection as the Production source of truth
