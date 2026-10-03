# ID / Password認証の安全な共通基盤

## 目的

SSO / OIDC / SAMLを利用できない業務システム向けに、ID / Password認証を既存Authentication Foundationへ安全に接続するためのReference実装を提供します。

この機能はOIDCやSAMLの代替をTemplate全体へ強制するものではありません。必要なProjectだけが採用します。

## できること

- Project定義のlogin identifierを正規化して一意保存する
- Passwordを平文保存せずPBKDF2-HMAC-SHA256でhash化する
- userごとのrandom saltを使う
- hash文字列へiteration数を含め、将来のparameter引き上げ時にrehashできる
- Password変更時に既存Application Sessionをすべて失効する
- Password Reset Tokenをrandom opaque tokenとして発行する
- Reset TokenはSHA-256 hashだけをD1へ保存する
- Reset Tokenへ有効期限と一回利用を適用する
- Password Reset成功後に既存Application Sessionをすべて失効する
- credentialが存在しない場合もdummy password derivationを行い、単純な存在有無差を減らす

## Password hash

Workersで標準利用できるWeb Cryptoを使い、Reference実装は次を採用します。

```text
PBKDF2-HMAC-SHA256
iterations: 600,000
salt: 16 random bytes per credential
output: 256 bits
```

保存形式は次です。

```text
pbkdf2-sha256$<iterations>$<salt-base64url>$<hash-base64url>
```

平文PasswordはDB、通常Log、Auditへ保存しません。

`iterations`は保存形式に含めます。認証成功時に現在の設定より古いparameterであることを検出した場合、条件付きUPDATEで新しいhashへupgradeできます。

## Password policy

Referenceの新規Password policyは以下です。

- minimum: 15 code points
- maximum: 128 code points
- 文字種の強制はしない
- Unicodeはhash前にNFKC正規化する
- Projectが用意するblocklistで既知の弱いPasswordを拒否する

BlocklistはCoreへ具体データを埋め込みません。Project側で静的list、組織policy、外部breached-password provider等を選択します。

公開画面でPassword policyの詳細をどこまで説明するかはProjectのUX判断です。

## Login identifier

Default正規化は以下です。

```text
NFKC
trim
lowercase
control character reject
max 254 code points
```

これはReferenceです。社員番号等でcase-sensitive semanticsが必要なProjectは`normalizeIdentifier`を差し替えます。

`identifier_normalized`は一意ですが、メールアドレスであることをCoreは要求しません。

## Account enumeration境界

`authenticate()`は外部向けに次だけを返します。

```text
success -> internal user id
failure -> null
```

次を区別しません。

- identifierが存在しない
- userがdisabled
- Passwordが違う

存在しないidentifier / disabled userでもdummy hash workを行います。ただし、これだけで総当たり・credential stuffing・timing attack対策が完成するわけではありません。

**公開Login endpointへ接続する前に #100 Credential Attack Hardeningを適用してください。**

#100ではidentifier/IP/endpoint単位のfailure state、temporary throttle/lock、generic error、Rate Limitとの責務分離を扱います。

## Password変更

Password変更は次の順序です。

1. 現在のPasswordを検証する
2. 新Passwordをpolicy / blocklistで検証する
3. 新hashを生成する
4. 現在見えている旧hashを条件にcredentialを更新する
5. 更新後のhashが存在する場合だけactive Application Sessionを失効する
6. 未使用Reset Tokenも失効する

旧hashが途中で変わった場合は`concurrent_change`としてfail closedします。

Password変更後に古いSessionを継続利用させません。

## Password Reset

Reset Tokenは32 random bytesのopaque tokenです。

```text
raw token
  -> 利用者へ一度だけ渡す
  -> SHA-256
  -> D1にはhashだけ保存
```

Default TTLは30分、Core上限は24時間です。

新Token発行時は同じuserの未使用Tokenを失効します。Reset成功時は対象Tokenを一回利用済みにし、そのuserの残りのReset TokenとApplication Sessionも失効します。

Reset TokenやReset URLを通常Log / Auditへ残してはいけません。

## DB

`0019_local_credentials.sql`は次を追加します。

```text
local_credentials
  user_id PK/FK
  identifier_normalized UNIQUE
  password_hash
  password_changed_at
  created_at
  updated_at

password_reset_tokens
  id PK
  token_hash UNIQUE
  user_id FK
  expires_at
  consumed_at
  created_at
```

Password変更履歴、Password本文、Reset Token本文は保存しません。

## Sessionとの関係

Local Credential認証はApplication Sessionそのものを置き換えません。

```text
ID / Password検証
        ↓
internal user
        ↓
既存Application Session
```

Session発行・Cookie属性・idle timeout・revocation・rotationは既存Authentication Foundationを再利用します。

認証状態変更時のSession Token再発行は#88 Session Rotation Guardを使い、Local Credential固有コードへ重複実装しません。

## Audit / Logging

記録してよいものは、ProjectのAudit policyで許可されたbounded metadataだけです。

例:

- authentication success / failure category
- internal user id（認証後に確定した場合）
- controlled reason code
- request / correlation id

次は記録しません。

- Password
- password hash
- salt
- raw Reset Token
- Reset Token hash
- Cookie / Session Token
- full login form body

## Public HTTP endpointは別責務

このFoundationはPassword verification / change / resetのCore serviceです。

まだ次を追加しません。

- public login route
- public forgot-password route
- account existenceを隠すHTTP response設計
- brute-force / credential stuffing state
- CAPTCHA / Turnstile
- account management UI

公開Login / Recovery endpointへ接続する場合は#100を先に組み合わせます。

## Production / Human Gate

このFoundationのPRで以下は行いません。

- Production userへのlocal credential provision
- 実Password登録
- 実Resetメール送信
- Production DB migration実行
- Production login endpoint公開

ProductionでLocal Credentialを採用するかはProject requirementとして明示的に決定してください。
