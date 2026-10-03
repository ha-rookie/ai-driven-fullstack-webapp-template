# Recipe: Local Credential Authentication

## Inputs
- local identifier semantics（username / email等）
- Password blocklist strategy
- Account provisioning / recovery policy
- Reset notification channel
- Login / Reset endpointへ適用するCredential Attack Hardening方針

Read `../AUTH_DESIGN.md`, `../AUTH_LOCAL_CREDENTIAL.md`, and `../instructions/authentication-session.md` first.

## Stop Conditions
Stop when:
- ProjectがOIDC/SAMLではなくLocal Credentialを本当に必要としているか未決定
- identifierの一意性・normalization semanticsが未決定
- Password blocklistの運用方法が未決定
- Reset Tokenの通知経路が未決定
- 公開Login endpointへ接続するのに #100 Credential Attack Hardeningが未適用
- Password / Reset TokenをLog/Auditへ出す設計になっている
- PBKDF2 default未満のwork factorをPreview / Productionで使う必要がある

## Steps
1. `LocalCredentialService`を既存`users`へ接続する
2. Project固有identifier normalizerが必要なら明示的に差し替える
3. `PasswordBlocklist`をProjectから注入する
4. 新Passwordはpolicy検証後に`PasswordHasher`でhashする
5. DBへ平文Passwordを保存しない
6. Login失敗時はidentifier不存在 / disabled / Password不一致を外部contractで分離しない
7. Password変更成功時は既存Sessionをrevokeする
8. Password Reset Tokenは生値を一度だけ返し、DBにはSHA-256 hashのみ保存する
9. Reset成功時はTokenをconsumeし既存Sessionをrevokeする
10. Reset通知が必要なら`EMAIL_DELIVERY.md`を併用する
11. 公開Login/Reset HTTP endpointを作る場合は #100 / Rate Limit / Audit境界を先に適用する
12. Login成功後は既存opaque Application Sessionを発行し、必要な境界変更ではSession Rotationを使う

## Validation
- PBKDF2 saltがhashごとに異なる
-正しいPasswordだけverifyできる
- 古いwork factorを`needsRehash`として検出できる
- Password policyのlength / blocklistが動く
- identifier normalizationが決定的
- 不存在identifierでもdummy KDF workが実行される
- disabled userを認証しない
- Password変更後に旧Passwordが使えずSessionがrevokeされる
- Reset TokenがDBへ平文保存されない
- Reset Tokenがone-timeで、Reset後にSessionがrevokeされる
- `npm run local-credential:local`
- `npm run validate:local`
- lint / build / existing auth boundary tests

## Evidence
Record:
- identifier semantics
- Password policy / blocklist source
- Password hash algorithm / work factor
- Reset TTL / notification channel
- Session revoke/rotation policy
- Credential Attack Hardening connection point
- Local / CI evidence
- Preview evidence when public endpoints are explicitly enabled

## Do Not
- 平文Passwordを保存・Log・Auditする
- Reset Token生値またはhashを通常Logへ出す
- email文字列だけを理由にOIDC/SAML userと自動linkする
- Local Credential用に別Session方式を作る
- Password変更/Reset後も既存Sessionを有効なままにする
- 文字種composition ruleをTemplate標準へ戻す
- 定期Password変更をTemplate標準で強制する
- 公開Login endpointを#100なしで完成扱いにする
- test-only low PBKDF2 iterationsをPreview / Productionへ持ち込む
