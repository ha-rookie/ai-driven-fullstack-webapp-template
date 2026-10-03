# Credential Attack Hardening Recipe

## Inputs

着手前にProjectで決める。

- 対象credential endpointの安定した`endpointId`
- `failureThreshold`
- `windowSeconds`
- `lockSeconds`
- identifierのcanonicalization方法
- network identityを使う場合のtrusted extraction boundary
- #68 Rate Limit policy
- Store障害時にendpointを503へ倒すか等のavailability / security方針
- Recovery requestのgeneric response文言

## Stop Conditions

次の場合は自動で先へ進めない。

- ProductionのLogin / Recovery endpointを有効化する必要がある
- WAF / Turnstile / Cloudflare Rate Limiting ruleを変更する必要がある
- Production D1へ直接stateを書き込む必要がある
- raw Password / identifier / IPをLogやAuditへ残す必要がある設計になっている
- permanent Account lockをTemplate標準として導入しようとしている
- identifier不存在時だけGuardを回避する設計になっている

## Steps

1. #37 Local CredentialのPassword verification境界を確認する
2. endpointごとの#68 Rate Limitを先に評価する
3. `CredentialAttackPolicy`をProject設定から組み立てる
4. credential verification前にidentifier/network dimensionの`check()`を評価する
5. reject時はgeneric 429 + `Retry-After`を返す
6. credential verificationが失敗したら、Account存在有無に関係なく`recordFailure()`する
7. threshold到達時は#91 `fromCredentialAttackRejection()`へ接続する
8. Login成功時はidentifier dimensionを`recordSuccess()`でclearする
9. network dimensionは成功した1利用者だけを理由に自動clearしない
10. Recovery requestはAccount存在有無で外部responseを変えない

## Validation

Local / CIで確認する。

- threshold未満はallow
- threshold到達でtemporary lock
- `Retry-After`が正数
- lock期限後に新windowで1から再開
- failure window expiryでcount reset
- identifier / networkが独立
- Preview / Productionが独立
- raw identifier / IPがD1へ保存されない
- missing Accountでもfailure stateを作れる
- success時にidentifier stateをclearできる
- network stateは勝手にclearされない
- #91 event / Audit / Logにidentifier / IP / subject hashが出ない
- D1 migration / atomic UPSERT contract
- existing Rate Limit / Authentication / Browser / Security regression

## Evidence

PRへ残す。

- Unit test結果
- Local D1 contract結果
- Production schema verification
- Full local validation / lint / build
- Browser E2E
- Security / Supply-chain workflows
- Remote / Production操作を行っていないこと

## Do Not

- Rate Limitのrequest countをcredential failure countとして流用しない
- Worker isolate-local MapをProduction正本にしない
- IPだけでAccountを永久blockしない
- identifierが存在する場合だけfailureを記録しない
- Account不存在とPassword不一致でclient responseを変えない
- Password / raw identifier / IP / subject hashを通常Log / Auditへ出さない
- throttleをMFAやPassword hashingの代替にしない
