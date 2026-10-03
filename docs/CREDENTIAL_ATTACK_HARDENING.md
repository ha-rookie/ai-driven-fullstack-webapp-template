# ID / Password認証への総当たり・アカウント探索対策

## 目的

ID / Password認証を公開HTTP endpointへ接続すると、Password hashが安全でも次の攻撃は残る。

- brute-force
- credential stuffing
- account enumeration
- Password Reset / Recovery endpointの大量試行

このFoundationは、**認証失敗の蓄積と一時的な制限**を共通化する。

Passwordを検証する責務は`LocalCredentialService`、単純なrequest量の制限は`RateLimitGuard`、拒否イベントの記録は`SecurityRejectionEvent`へ分離する。

## 責務分離

```text
HTTP request
   ↓
#68 Rate Limit Guard
   │  endpointへのrequest数を制御
   ↓
#100 Credential Attack Guard
   │  identifier / networkごとの認証失敗状態を確認
   ↓
#37 Local Credential Service
   │  Passwordを検証
   ├─ failure → #100 recordFailure
   └─ success → identifier側だけrecordSuccess
```

Rate LimitとCredential Attack Stateは同じものではない。

- Rate Limit: requestが来た回数
- Credential Attack: credential verificationが失敗した回数

Rate Limitを通過してもcredential failureは蓄積する。逆にCredential Attack Guardだけで大量requestによるresource消費を防げるとは扱わない。

## Control Key

ProjectからGuardへ渡すsubjectは2種類。

- `identifier`: login ID / email等のcredential identifier
- `network`: 信頼境界で抽出・検証済みのnetwork identity

D1へraw identifier / raw IPは保存しない。

保存キーは次から作る。

```text
environment
endpointId
dimension
SHA-256(version + dimension + canonical subject)
```

Preview / Productionは`environment`で分離する。

SHA-256は暗号化ではない。identifierの候補空間によっては推測可能なpseudonymous valueなので、通常Log / Auditへsubject hashも出さない。

## Failure Window / Temporary Lock

PolicyはProjectが明示する。

- `failureThreshold`
- `windowSeconds`
- `lockSeconds`

Templateは具体的なLogin閾値を業務要件なしに固定しない。

Reference動作:

1. window内の失敗回数を記録
2. threshold到達で`lockedUntil`を設定
3. lock中はcredential verificationへ進まずgeneric 429を返せる
4. lock期限後の次の失敗は新しいwindowの1回目として扱う
5. permanent lockは作らない

D1のfailure更新は1つの`INSERT ... ON CONFLICT DO UPDATE`で行い、複数Workerからのfailure incrementをread-modify-writeのprocess memoryへ依存させない。

## Identifier不存在時

**存在しないidentifierでもfailureを記録する。**

実在Accountだけにfailure stateを作ると、throttle挙動の差からAccount存在を推測される可能性があるため。

#37側もidentifier不存在 / disabled / Password mismatchを同じ認証失敗結果へ収束し、不存在時もdummy KDF workを行う。

## 成功時のReset

Login成功時は、そのidentifierのfailure stateをclearできる。

ただし共有networkから1人が成功しただけで攻撃履歴を消さないため、**network dimensionは成功時に自動clearしない**。

## Client Error

Temporary lock時のReference response:

- HTTP `429`
- code: `authentication_temporarily_limited`
- generic message
- `Retry-After`

Responseには以下を含めない。

- Account存在有無
- failure count
- identifier
- IP/network identity
- subject hash
- Password検証結果の詳細

通常のPassword不一致も、identifier不存在とclient-facing detailを分けない。

## Security Rejection / Audit

#91へ`credential_attack_rejected / credential_attempt_throttled`を追加する。

Eventへ含めるのはbounded metadataだけ。

- requestId
- method / path
- credential endpoint ID
- rejection reason

含めないもの:

- identifier
- IP/network identity
- subject hash
- Password
- Password hash
- Reset Token

## Password Reset / Recovery

「Resetメールを要求する」endpointでは、対象Accountが存在するかどうかをclientへ分けて返さない。

例:

```text
If the account can receive recovery instructions, they will be sent.
```

実際のEmail送信はAccountが内部で解決できた場合だけ行うが、外部responseは同じ形にする。

Reset Tokenの検証失敗やRecovery endpointへの大量試行には、Project要件に応じてRate LimitとCredential Attack Guardを組み合わせる。

## Store

### Local / Test

`InMemoryCredentialAttackStore`

Worker isolate memoryなのでProduction正本には使わない。

### Preview / Production

`D1CredentialAttackStore`

`credential_attack_states`へ次だけを保存する。

- environment
- endpoint ID
- dimension
- subject hash
- failure count
- window start
- temporary locked until
- updated at

raw identifier / raw network identityは保存しない。

## Failure Semantics

Store障害を`allow`へ暗黙変換しない。

Guardからの例外をcallerへ伝え、対象endpointの可用性とSecurity要件に応じて503等を選ぶ。

Template Coreでは、すべての案件に対してsilent fail-open / fail-closedを一律固定しない。

## Production / Remote

このFoundationのPRでは以下を行わない。

- Production credential作成
- Production login
- Production state mutation
- WAF / Turnstile設定
- Cloudflare Rate Limiting rule変更

Productionで公開Loginを有効にする判断はHuman Gateとする。

## Out of Scope

- Password hashing（#37）
- CAPTCHA / Turnstile製品固定（#149）
- WAF / bot management
- OIDC/SAML Provider側credential policy
- permanent Account lock
- IP-only blockをTemplate標準にすること
