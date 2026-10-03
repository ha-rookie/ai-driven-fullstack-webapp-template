# Durable Audit Storage Recipe

## Use when

既存のStructured Audit Eventを、Consoleだけでなく後から検索できるprivateな永続Storeへ保存したいときに使います。

Audit Event自体を新しく設計する場合は先に `AUDIT_EVENT.md` を使います。

## Inputs

作業前に少なくとも次を決めます。

- durable保存が必要なAudit action
- 保存理由
- retention日数
- Preview / Productionのresource分離
- 誰が検索できるか
- exportを許可するか
- `best_effort` / `required` のどちらを使うか
- stronger tamper resistanceが必要か

## Stop Conditions

次が未決定ならProduction運用へ進みません。

- retention期間
- Production Audit閲覧権限
- export先のprivacy
- purge実行責任者・方法
- `required` を選ぶ場合の業務更新との整合性
- 法令・契約でWORM/署名等が必要かどうか

`required` は業務更新とのatomic transactionを意味しません。完全な同時成功/失敗が必要ならProject固有設計へ分離します。

## Steps

1. `../AUDIT_OBSERVABILITY.md` で対象Eventがbounded contractに収まっていることを確認する
2. `../DURABLE_AUDIT_STORAGE.md` で保存禁止データと環境分離を確認する
3. Local D1へ `0016_durable_audit_storage.sql` を適用する
4. Projectのcomposition rootで `D1DurableAuditStore` を生成する
5. durable保存が必要なEventだけ `writeDurableAudit()` へ渡す
6. `best_effort` / `required` を明示する
7. 検索側はProject固有Authorizationを必ず通す
8. retention purgeは環境単位・bounded batchで実行する
9. Previewで保存・検索・purge rehearsalを確認する
10. Production migration / retention / export / purgeは既存Human Gateに従う

## Validation

Local / CIでは少なくとも次を確認します。

- migrationがLocal D1へ適用できる
- Production schema baselineにtable/indexが含まれる
- Preview/Production environmentが混ざらない
- query valueがSQLへ文字列連結されずbindされる
- hash mismatchがfail closedになる
- retentionDays / batch sizeの不正値を拒否する
- AuditEventの余分なfieldを保存しない
- best-effort / requiredの差がtestされている

Previewでは、実Projectが明示実行する場合だけ保存・検索・purge rehearsalを行います。

## Evidence

PRまたは運用記録には次を残します。

- durable対象action
- retentionの根拠
- write mode
- search/export access policy
- Preview rehearsal結果
- Production migrationを行った場合のRelease Evidence
- Production purge/exportを行った場合の実行記録

## Do Not

- token / Cookie / password / request bodyを保存しない
- Production Auditをpublic GitHub Artifactへ出さない
- PreviewからProduction Auditを検索しない
- arbitrary SQL検索APIを作らない
- Feature FlagやFrontend非表示をAudit閲覧権限の代わりにしない
- SHA-256だけでWORM/tamper-proofと表現しない
- `required` だけで業務更新とのatomicityがあると表現しない
- 通常PR CIからProduction purge/exportを実行しない
