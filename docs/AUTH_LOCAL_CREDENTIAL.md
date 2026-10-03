# ID / Password認証の安全な共通設計

## 目的

OIDC / SAMLを使えないProject向けに、ID / Password認証を既存のAuthentication Foundationへ安全に接続するReference実装を定義する。

このFoundationは**Password保存・検証・変更・Reset**を担当する。公開Login endpoint、総当たり対策、MFA、Account管理UIは別責務とする。

## 責務境界

```text
Login Identifier + Password
        ↓
LocalCredentialService
        ↓
Password hash verification
        ↓
Internal User
        ↓
既存 Application Session
```

Local Credentialを使っても、Application Sessionは既存のDB-backed opaque sessionを利用する。PasswordやPassword hashをSessionへ持ち込まない。

## Password保存

Reference実装はCloudflare WorkersのWeb Cryptoで利用可能なPBKDF2-HMAC-SHA256を使う。

- default work factor: 600,000 iterations
- userごとに16-byte random salt
- derived key: 256 bit
- 保存形式にalgorithm / iterations / salt / hashを含める
- 平文Passwordを保存しない
- iteration数が現在値より古い場合、正常Login時にrehashできる

保存形式:

```text
pbkdf2-sha256$<iterations>$<salt-base64url>$<hash-base64url>
```

PBKDF2を「最も強いPassword hashing方式」とは扱わない。Argon2id等をWorkers runtimeで安全に利用できるProjectは、`PasswordHasher` Adapterを差し替えてよい。Template Coreを特定libraryへ固定しない。

## Password policy

Reference defaults:

- single-factor Passwordとして15 Unicode code points以上
- 最大128 code points
- 文字種の組み合わせルールを要求しない
- Project supplied blocklistで既知の弱い/漏えいPasswordを拒否する
- Passwordはhash前にNFKC normalizationする
- 定期的な強制Password変更をTemplate標準にしない

ProjectはBlocklistの入手元・更新方法・Privacy boundaryを決める。外部breached-password APIはBaseline依存にしない。

## Identifier

Reference `normalizeLocalIdentifier()` はNFKC、trim、lowercaseを適用する。

ただし「usernameを使うかemailを使うか」はProject判断であり、Templateはemailを必須にしない。Projectが独自identifier semanticsを持つ場合はnormalizerを差し替える。

## 認証失敗時の境界

`authenticate()` は外部へ次を区別して返さない。

- identifier不存在
- user disabled
- Password不一致

いずれも`null`として扱う。

identifier不存在/disabled時もPassword KDF相当のdummy workを行い、単純な存在有無によるtiming差を広げない。ただし、このCoreだけでbrute-force / credential stuffing / account enumeration対策が完成するわけではない。

公開Login endpointへ接続する前に #100 Credential Attack Hardeningを適用する。

## Password変更

Password変更は現在Passwordを再検証してから新Passwordへ変更する。

成功時:

- `password_hash`を置換
- `password_changed_at`を更新
- 既存Application Sessionをすべてrevoke
- 未使用Password Reset Tokenをすべてconsume

同時変更を検出した場合は成功扱いにしない。

## Password Reset

Reset Tokenは32-byte random opaque tokenを生成する。

DBへ保存するのはSHA-256 hashだけで、生Tokenは保存しない。

- default TTL: 30分
- 最大TTL: 24時間
- 新Token発行時に既存未使用Tokenを無効化
- Tokenはone-time use
- expired / consumed / disabled userは失敗
- Reset成功時は既存Sessionをすべてrevoke
- Reset成功時は他の未使用Reset Tokenも無効化

生Reset Tokenはメール等の保護された経路へ一度だけ渡し、通常Log / Audit / DBへ残さない。

## Sessionとの接続

新規Login成功後のApplication Session発行、認証レベル変更時のSession Rotationは既存Authentication Foundationを使う。

Password変更/Resetはcredential compromiseを想定し、既存Sessionを全revokeする。

#37では新しい公開Login endpointを追加しないため、Login成功後のSession発行HTTP flowはProjectまたは後続Issueで接続する。

## Audit / Logging

通常Log / Auditへ出してよいのはbounded metadataだけとする。

保存禁止:

- Password
- Password hash
- salt
- Reset Token
- Reset Token hash
- Session Token / Cookie

認証失敗理由を利用者向けerrorへ細かく露出しない。

## Local / Preview / Production

Local / CI:

- test用のlow-cost PBKDF2は明示的なtest-only escape hatchでのみ許可
- migration / schema / service contractを検証する
- Remote resourceは使わない

Preview / Production:

- PBKDF2 default未満のwork factorを許可しない
- Reset通知にEmailを使う場合はEmail Delivery Foundationを利用する
- public Login endpointを出す前にCredential Attack Hardeningを適用する
- Production credential作成・実アカウントLoginはHuman-triggered evidenceとする

## Out of Scope

- Login画面
- 公開Login / Reset HTTP endpoint
- brute-force / credential stuffing / account enumeration対策（#100）
- CAPTCHA / Turnstile
- MFA / Passkey（#53）
- breached-password external API固定
- Account管理UI
- OIDC / SAMLとの自動Account linking
