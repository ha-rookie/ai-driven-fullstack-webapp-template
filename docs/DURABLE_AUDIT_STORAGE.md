# 監査記録を長期間保存・検索する仕組み（Durable Audit Storage）

## 目的

業務システムでは、障害解析だけでなく、後から次のような確認が必要になることがあります。

- 誰が操作したか
- いつ操作したか
- どの範囲・どのデータに対する操作だったか
- 成功したか失敗したか
- どのrequestと対応するか

既存の `AUDIT_OBSERVABILITY.md` では、これらを安全な構造化Audit Eventとして作るところまで共通化しています。

このFoundationは、そのAudit Eventを**後から検索・保持できるprivateな永続領域へ保存するための境界**を追加します。

## できること

Template標準ではD1実装を提供します。

```text
AuditEvent
  ↓ allowlisted projection
StructuredAuditRecord
  ↓ shared redaction
JSON
  ↓ SHA-256
D1 durable_audit_events
```

保存される主な検索項目は次です。

- environment
- occurred_at
- request_id
- category
- action
- outcome
- actor_id
- scope_id
- resource_type
- resource_id

Audit Event本体は `record_json` として保存し、`record_sha256` で読み出し時の整合性を確認します。

## D1を標準実装にする理由

このFull-stack TemplateはCloudflare Workers + D1を基盤としているため、検索可能な最小実装としてD1を採用します。

ただし、Auditの上位契約は `DurableAuditSink` として分離します。

Project要件に応じて、将来次へ差し替えることを妨げません。

- R2等のprivate object storage
- Cloudflare Logpush
- SIEM
- 外部の監査ログ専用Store

Templateは特定SIEM製品を必須にしません。

## 環境分離

すべての永続Audit行は `environment` を必須で持ちます。

許可値は次だけです。

- local
- test
- preview
- production

`D1DurableAuditStore` は生成時にenvironmentを固定し、検索・purgeでも必ずそのenvironmentを条件に含めます。

Preview StoreからProduction行が返された場合は、通常結果として返さずIntegrity Errorにします。

## 何を保存しないか

既存Audit契約と同じく、次は保存しません。

- password
- access token / refresh token
- session token / token hash
- Cookie
- Authorization header
- OAuth code
- request / response body全文
- 自由記述本文
- 不要なメールアドレスや電話番号などのPII

保存前に既存のallowlisted projectionとshared redactionを通します。

ただし、key-based redactionは完全なDLPではありません。`reason`、`resourceId`、`action`等へ秘密情報や不要な個人情報を埋め込まないことが前提です。

## 検索境界

`D1DurableAuditStore.search()` は自由SQLを受け取りません。

検索できる条件は次に限定します。

- startAt / endAt
- category
- outcome
- action
- actorId
- scopeId
- resourceType
- resourceId
- stable cursor
- limit（最大100件）

値はSQL文字列へ連結せずbind parameterとして渡します。

並び順は次で固定します。

```text
occurred_at DESC
id DESC
```

HTTP APIとして公開するProjectでは、この内部cursorをそのまま利用者へ信頼させず、`Collection Query Contract` のopaque/verified cursorへ包んでください。

## Retention / Purge

Templateは「監査ログは一律何年保存」と決めません。

Projectが法令・契約・業務要件・コストを確認して `retentionDays` を決めます。

`purgeExpired()` は次の性質を持ちます。

- environment単位
- 指定保持日数より古い行だけ削除
- 1回の削除件数をbatch sizeで制限
- batch上限は2000件
- 通常の行更新APIは提供しない

削除の定期実行方法はProject側責務です。通常PR CIからProduction purgeを実行しません。

## SHA-256の意味

`record_sha256` は、保存した `record_json` と読み出した内容が一致するか確認するための**整合性検知補助**です。

これはWORM storageや暗号学的な完全改ざん防止を意味しません。

DBを変更できる攻撃者がJSONとhashの両方を書き換えられる場合、単純SHA-256だけでは防げません。

契約・規制上、より強いtamper resistanceが必要なProjectでは、次のような追加設計を検討します。

- append-only external storage
- retention lock / WORM
- external signing
- immutable export
- privileged accessの分離

Templateはそれらを自動的に保証したとは扱いません。

## 保存失敗時の扱い

`writeDurableAudit()` では2つのモードを明示的に選べます。

### best_effort

Audit保存に失敗してもCore処理を失敗させません。

既存のConsole Auditに近い性質です。

### required

Audit保存に失敗した場合、`DurableAuditWriteError` を呼び出し側へ返します。

ただしこれは、**業務更新とAudit書き込みの原子性を保証するものではありません**。

たとえば業務DB更新後にAuditを書き、そのAuditだけ失敗した場合、業務更新自体はすでに成功している可能性があります。

規制・契約上「業務更新と監査記録が必ず同時に成功/失敗する」ことが必要なら、Project固有のtransaction設計・outbox・queue等を検討してください。

## Access Control

このFoundationは保存・検索Storeを提供しますが、一般利用者向けAudit検索APIや管理画面は提供しません。

Projectが検索APIを作る場合は、通常のAuthorizationより強い権限境界が必要になることがあります。

少なくとも次をProjectで決めます。

- 誰がAuditを読めるか
- actorId等で自分以外を検索できるか
- exportできるか
- Production Auditへアクセスできるか
- export先をprivateにできるか

Audit検索画面を作るだけで管理者権限が成立するとは扱いません。

## ProductionとPreview

PreviewとProductionは同じAudit Storeとして扱いません。

- environment列で論理的に分離
- 実Projectではresource自体も分離することを推奨
- Production AuditをPreviewへコピーしない
- Production Auditをpublic GitHub Artifactへ出さない
- Production export / purge / retention変更はHuman Gate対象

## Migration

D1標準実装は次のmigrationを使います。

```text
migrations/0016_durable_audit_storage.sql
```

Production schema baselineにも `durable_audit_events` と必要Indexを追加しています。

これはPR mergeだけでProduction migrationを実行するという意味ではありません。

実Production migrationは既存のProduction Migration / Preflight / Human Gateに従います。

## Out of Scope

- SIEM製品固定
- Audit検索UI
- full-text search
- arbitrary SQL
- user向けAnalytics
- WORM保証
- external signing
- Production自動purge
- Production自動export
- 業務更新との自動transaction統合

## 関連

- `AUDIT_OBSERVABILITY.md`
- `DATA_LIFECYCLE_BACKUP.md`
- `AUTHORIZATION_DESIGN.md`
- `src/worker/audit/durable-audit-store.ts`
- `migrations/0016_durable_audit_storage.sql`
- `tests/durable-audit-storage.test.ts`
