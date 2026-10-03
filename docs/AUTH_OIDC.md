# Google / Microsoft等の外部ログインを安全に接続する仕組み（OIDC / OAuth）

## 目的

このTemplateにはApplication Sessionと外部Identityの共通基盤があります。本機能は、Google等のOIDC Providerで本人確認した結果を、既存の`VerifiedExternalIdentity`へ変換するAdapterです。

ProviderのAccess TokenやID TokenをApplication Sessionとして使い回しません。

## できること

- Authorization Code Flow
- PKCE（S256）
- `state`によるcallback CSRF対策
- `nonce`によるID Token replay対策
- OpenID Connect Discovery Document取得
- JWKSからRSA公開鍵を取得
- RS256署名検証
- `iss` / `aud` / `azp` / `exp` / `iat` / `nonce` / `sub`検証
- Provider固有claimをCore Userへ流さず`provider + sub`へ正規化
- Google用Reference設定

## 責務の流れ

```text
Browser
  ↓ login開始
ProjectのHTTP Boundary
  ↓ state / nonce / PKCE transactionを安全に保持
OidcAuthProvider.createAuthorizationRequest()
  ↓
Google等のOIDC Provider
  ↓ authorization code + state
Projectのcallback Boundary
  ↓ state照合
OidcAuthProvider.verify()
  ↓ code + code_verifierをtoken endpointへ交換
  ↓ ID Token署名/claims検証
VerifiedExternalIdentity { provider, subject, displayName }
  ↓
既存のexternal identity / user / Application Session基盤
```

## Google Reference

Google用には`createGoogleOidcAuthProvider()`を用意しています。

Reference設定:

- Discovery: `https://accounts.google.com/.well-known/openid-configuration`
- Provider key: `google`
- Scope: `openid profile email`
- Identity key: Google ID Tokenの`sub`

`email`は変更される可能性があるため、Templateでは外部Identityの一意キーとして使いません。

## callbackで必ず保持・照合する値

login開始時にProject側で以下を短時間だけ安全に保持します。

- `state`
- `nonce`
- `codeVerifier`
- login開始時刻 / expiry
- 必要ならlogin後の安全なreturn path

これらを通常Log / Auditへ出しません。

`state`が一致しないcallbackではtoken endpointへアクセスしません。

## Transaction保存方式

Template Coreは保存方式を固定しません。Projectは次のいずれかを明示的に選びます。

- server-side D1 / KV等にopaque transaction IDだけをCookieへ持たせる
- 十分に保護された短寿命の暗号化Cookie
- Provider/Frameworkが安全に提供するtransaction store

署名だけで暗号化していないCookieへ`codeVerifier`等をそのまま入れる方式は、Projectがリスクを理解せず採用しないでください。

## User provisioning / linking

OIDC検証成功は「この外部IdentityをどのApplication Userへ紐付けるか」を自動決定しません。

Project側で次を決めます。

- 既存`provider + sub`がある場合のみlogin許可するか
- 初回loginでuserを作るか
- Invitation済み利用者だけ作成するか
- 既存userへIdentityを追加する条件
- Workspace domain等の追加条件

メールアドレス一致だけで既存Userへ自動linkしません。

## Preview / Production分離

最低限、環境ごとに次を分けます。

- OAuth Client ID
- Client Secret
- Authorized Redirect URI
- callback origin
- transaction保存先

Preview credentialをProductionへfallbackしません。

## Secret / Log境界

通常Log / Auditへ出してはいけないもの:

- authorization code
- access token
- refresh token
- ID Token全文
- client secret
- PKCE code verifier
- state / nonce
- raw Provider response

障害調査ではProvider名、共通error code、request/correlation ID等の低機密metadataを使います。

## Remote / Production Human Gate

以下はTemplate実装だけでは行いません。

- Google Cloud等でOAuth Clientを作成
- Preview / Production redirect URI登録
- Client Secret登録
- 実アカウントでlogin
- consent screen公開
- Provider quota / policy変更

これらはProject側のHuman Gateです。

## Out of Scope

- SAML 2.0（#36）
- ID / Password（#37）
- MFA / Passkey（#53）
- User管理UI
- Refresh Tokenを使ったGoogle API利用
- Provider Access Tokenの長期保存

## 公式Reference

- Google OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
- Google OIDC API Reference: https://developers.google.com/identity/openid-connect/reference
- Google OAuth 2.0 Web Server Apps: https://developers.google.com/identity/protocols/oauth2/web-server
