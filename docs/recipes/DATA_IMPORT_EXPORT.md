# CSV業務データ取込・出力 Recipe

## Use when

以下を実装するときに使います。

- CSVでマスタを一括登録・更新する
- 他システムからCSVでデータ移行する
- 一覧・検索結果をCSV出力する
- 帳票作成前の表形式データを出力する

添付PDF・画像等の保存は `OBJECT_STORAGE.md`、ブラウザとのファイル受け渡しは `FILE_TRANSFER_HTTP.md` を使います。

## Inputs

実装前にProject側で決めます。

- 許可するCSV列
- 必須列 / 任意列
- 文字コード。BaselineはUTF-8
- max bytes / max rows
- unknown columnをrejectするか
- fieldごとのparse rule
- business key / duplicate check
- Dry-run画面の要否
- `all_or_nothing` / `partial` のどちらを許可するか
- commit時transaction / concurrency / idempotency方針
- Export対象field
- PIIをreveal / mask / omitする基準
- CSV formula injectionをprefixで無害化するか、rejectするか
- 同期処理からAsync Jobへ切り替える閾値

## Stop Conditions

次の場合は自動的に先へ進めません。

- Production実データをImportする
- Productionで大量一括更新を行う
- destructive overwrite / deleteを伴うImportを行う
- partial importの業務許容条件が未定義
- PII Exportの権限・利用目的が未定義
- 大量データなのに同期HTTPで処理する前提しかない
- Excel macro等、CSV Referenceの責務を超える要件が入った

Remote / Production / destructive operationはHuman Gate対象です。

## Steps — Import

1. `CsvImportSchema` へ公開を許可するcolumnだけ定義する
2. required / parse ruleを定義する
3. `maxBytes / maxRows` をProject設定として決める
4. `parseAndValidateCsvImport()` でDry-run previewを作る
5. rowNumber付きerror / warningを利用者へ表示する
6. invalid rowを勝手に補正・skipしない
7. commit前に必要なbusiness ruleを `revalidate` する
8. commit時に `all_or_nothing` / `partial` を明示する
9. D1 transaction / optimistic concurrency / idempotencyをProject Use Case側で適用する
10. threshold超過時は #51 Async Job側へ切り替える

## Steps — Export

1. Authentication / Resource Scope / Authorizationを先に評価する
2. Export専用columnsを明示する
3. PIIは必要なら #74 Data Maskingを適用する
4. Domain object全体を自動serializeしない
5. `formulaProtection` を明示する
6. `createCsvExportStream()` でstream生成する
7. HTTPでは `createAuthorizedCsvExportResponse()` を使い、安全なContent-Dispositionを返す
8. Auditには件数・actor・scope・requestId等のbounded metadataだけ残す

## Validation

最低限、以下を確認します。

### Import

- quoted comma
- quoted newline
- escaped quote
- invalid UTF-8
- max bytes
- max rows
- empty file
- header only
- duplicate header
- unknown column
- missing required column
- row number付きvalidation error
- all-or-nothingがinvalid previewでcommitしない
- partial modeが明示され、skip rowを結果へ残す
- commit直前revalidationで止められる

### Export

- selected fieldだけ出力する
- internal / secret fieldを意図せず出さない
- comma / quote / newlineを正しくescapeする
- formula-looking stringを無害化またはrejectする
- Authorization拒否時にrows queryを開始しない
- `private, no-store`
- `nosniff`
- safe `Content-Disposition`
- stream完了時の件数metadata

## Evidence

PRへ以下を残します。

- schema / policyの責務境界
- Dry-runとcommitの分離
- partial / all-or-nothingの選択方法
- CSV formula injection対策
- AuthorizationがExport queryより先であること
- unit / integration test結果
- large processingをAsync Jobへ逃がせる境界

Production Importを実行した場合は、Templateの実装完了とは別にProject Release / Audit evidenceを残します。

## Do Not

- CSV全体をD1 BLOBへ入れてImport基盤の代わりにしない
- invalid rowを黙ってskipしない
- Dry-run結果を確定データとして扱わない
- Product固有column名をTemplate Coreへ固定しない
- `partial` を暗黙defaultにしない
- Exportでobjectの全propertyを自動出力しない
- PII / secretを「一覧に見えているから」という理由だけでExportしない
- `=`, `+`, `-`, `@` で始まるuntrusted stringを無対策でSpreadsheetへ渡さない
- 大量Import / Exportを同期HTTPへ無制限に閉じ込めない
- #52 Object Storageや#261 File TransferへCSV業務validation責務を押し込まない
