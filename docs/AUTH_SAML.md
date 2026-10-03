# 企業向けSAML 2.0 SSOを安全に接続する仕組み

## 目的

このTemplateにはApplication Sessionと外部Identityの共通基盤があります。本機能は、企業IdPから受け取ったSAML Responseを**署名検証済みのAssertionへ変換するVerifier**と、その結果を既存`VerifiedExternalIdentity`へ接続するためのSAML固有境界です。

SAML固有のXML、証明書、属性名をCore Sessionへ直接流しません。

## できること

- SP Entity ID / ACS URLを持つSAML Service Provider設定
- HTTP-POST Binding用AuthnRequest生成
- SP Metadata生成
- opaqueな`RelayState`と`InResponseTo`によるlogin transaction照合
- IdP Entity ID照合
- Audience / Destination / Recipient照合
- Assertion発行時刻 / `NotBefore` / `NotOnOrAfter`検証
- signed Response / signed Assertionの許可方式をProjectごとに明示
- persistent NameIDまたは明示した属性を外部Identity keyへ変換
- transient NameIDを既定で拒否
- Assertion IDのReplayをD1で環境別に拒否
- 検証後は既存Application Session基盤へ接続

## 最重要の境界: XML署名検証をCoreで手書きしない

`SamlAuthProvider`は`SamlAssertionVerifier`を**必須注入**します。VerifierなしではACS成功経路を作れません。

Verifier実装は少なくとも次を満たす必要があります。

- XMLDSIGを検証してから結果を返す
- IdPの信頼済み証明書だけを使う
- duplicate XML IDを拒否する
- XML Signature Wrappingで署名対象と利用対象がずれないことを保証する
- 返却値を、署名によって保護されたResponse / Assertionのtrust pathからだけ取得する
- invalid signature / malformed XML / unsupported algorithmをfail closedで拒否する
- 生XMLや証明書秘密鍵を通常Log / Auditへ残さない

Template CoreはVerifier結果をそのまま信用せず、その後さらにAudience / Recipient / InResponseTo / time window / Replayを検証します。

## Workers runtimeとXMLDSIG library

2026-10時点の候補として`xmldsigjs`があります。Web CryptoベースのXMLDSIG実装で、RSA / ECDSA、canonicalization等を扱えます。

ただしCloudflare WorkersではXML DOM / XPath実装も含めてruntime compatibilityを確認する必要があります。このTemplateでは**依存libraryを未検証のまま標準依存へ追加しません**。

そのため現在のBaselineは:

1. SAML protocol / transaction / replay / identity mappingをTemplate Coreで共通化
2. XMLDSIGは`SamlAssertionVerifier` Adapterへ隔離
3. 採用Projectが選んだlibraryをPreviewで実IdP検証してからProductionへ進める

という構造です。

## Loginの流れ

```text
Browser
  ↓ SSO開始
Project HTTP Boundary
  ↓ createSamlLoginTransaction()
SamlAuthProvider.createAuthorizationRequest()
  ↓ SAMLRequest + opaque RelayStateをIdPへPOST
Enterprise IdP
  ↓ SAMLResponse + RelayState
ACS Boundary
  ↓ RelayState / request TTLを先に確認
SamlAssertionVerifier
  ↓ XMLDSIG / duplicate ID / signature wrappingを検証
VerifiedSamlAssertion
  ↓ Audience / Destination / Recipient / InResponseTo / time / replayを再確認
VerifiedExternalIdentity { provider, subject, displayName }
  ↓
既存external identity / user / Application Session基盤
```

## 外部Identity key

メールアドレス文字列を既定の一意キーにしません。

Projectは次のどちらかを明示します。

- `subjectMapping: { source: "nameId" }`
- `subjectMapping: { source: "attribute", name: "<stable attribute name>" }`

NameIDを使う場合、transient NameIDは既定で拒否します。persistent NameIDまたはIdP契約上変更されない属性を選んでください。

メールアドレス一致だけで既存Userへ自動linkしません。

## Replay protection

`0018_saml_assertion_replays.sql`で環境別のReplay Storeを用意しています。

一意キー:

```text
environment + provider + assertion_id
```

同じAssertion IDを再度使ったloginは拒否します。期限切れレコードはbounded purgeできます。

InMemory実装はLocal/Test専用です。ProductionでInMemoryをReplay正本にしないでください。

## Preview / Production分離

最低限、環境ごとに次を分けます。

- SP Entity ID
- ACS URL
- IdP側Application / Enterprise App設定
- IdP Metadata / signing certificate
- Replay Store environment

PreviewのEntity IDやACS URLをProductionへ暗黙fallbackしません。

## HTTP Boundaryで別途行うこと

このCoreはHTTP routeそのものを追加しません。Project側で次を実装します。

- SSO開始endpoint
- AuthnRequestをIdPへPOSTするform response
- ACS POST endpoint
- request body size limit
- `SAMLResponse` / `RelayState`の抽出
- login後return pathをopaque transactionへ紐付ける処理
- provider selection UIが必要な場合の画面

## Remote / Production Human Gate

以下はTemplate実装だけでは行いません。

- Microsoft Entra ID / Okta / Google Workspace等でEnterprise Appを作成
- IdP Metadata / signing certificate登録
- SP Entity ID / ACS URL登録
- 実企業アカウントでlogin
- certificate rotation
- Production IdP policy変更

これらはHuman-triggered Preview evidenceを経てProductionへ進めます。

## Out of Scope

- SCIM provisioning
- Enterprise directory同期
- MFA policy管理
- SAML Single Logout
- signed AuthnRequestを必須とするIdP向けSP秘密鍵管理
- IdP固有group/roleをCore Roleへ自動mapping

## Reference

- OASIS SAML 2.0 Technical Overview
- OASIS SAML 2.0 Core / Bindings / Metadata specifications
- Cloudflare Workers Web Crypto
- XMLDSIGjs: https://github.com/PeculiarVentures/xmldsigjs
