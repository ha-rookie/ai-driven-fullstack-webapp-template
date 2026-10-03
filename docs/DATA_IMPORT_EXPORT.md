# CSVなどの業務データ取込・出力を安全に共通化する仕組み

## 目的

業務システムで繰り返し発生する「CSVで一括登録する」「一覧をCSVで出す」を、案件ごとの場当たり実装にしないための共通基盤です。

#52 / #261 がPDF・画像・添付資料などの**ファイル本体の保存・受け渡し**を扱うのに対し、本機能はCSVの中身を**業務データとして解釈・検証・確定・出力する処理**を扱います。

```text
#52  ファイル本体をprivateに保存する
#261 ブラウザとファイルを安全に受け渡す

#262 CSV等の表形式データを
     読む → 検証する → 確認する → 確定する → 書き出す
```

Object Storageは必須ではありません。API、CLI、Async Job等からstreamを直接渡せます。

## できること

### 1. CSVを上限付きで読み取る

`parseAndValidateCsvImport()` は次を共通化します。

- UTF-8をReference encodingとする
- request全体のbyte数に上限を設定する
- data row数に上限を設定する
- quoted comma / quoted newline / escaped quoteを扱う
- 空ファイルを拒否する
- header onlyを既定で拒否する
- duplicate headerを拒否する
- unknown columnを既定で拒否する
- required column不足を拒否する
- malformed CSV / invalid UTF-8を明示エラーにする

無制限に巨大CSVを読み込む用途ではありません。同期処理に適さないサイズは `recommendCsvImportExecution()` で `async_job` 側へ振り分ける境界を持ちます。

### 2. 案件固有の列定義を外から注入する

Templateへ `顧客コード` や `部署名` などのProduct固有列は固定しません。

```ts
const schema = {
  columns: [
    { key: "id", header: "id", required: true, parse: parsePositiveInteger },
    { key: "name", header: "name", required: true },
  ],
  build: (values) => ({
    ok: true,
    value: { id: values.id, name: values.name },
  }),
};
```

各Projectは以下を決めます。

- どの列を許可するか
- 必須列・任意列
- 文字列からnumber / date / boolean等へどう変換するか
- business key重複等をどこで検証するか
- warningとerrorをどう分けるか

## 3. 不正行を黙って捨てない

各data rowには元CSV上の行番号を保持します。

```text
2行目: valid
3行目: idが整数ではない
4行目: nameが空
```

invalid rowを自動補正したり、黙ってskipしたりしません。

`CsvImportPreview` には次が残ります。

- totalRows
- validRows
- invalidRows
- warnings
- 各行のrowNumber
- 各行のvalidation issues
- validな場合の変換後value

これにより画面側で「3行目のidを確認してください」のように表示できます。

## 4. Dry-runと確定登録を分ける

CSVを読み取っただけではDB更新済みと扱いません。

```text
CSV
 ↓
parse / validate
 ↓
Dry-run Preview
 ↓
利用者確認・業務確認
 ↓
commit時に再validation
 ↓
Project側のtransaction / batch / concurrency control
```

`commitCsvImportPreview()` は `mode` を必須にします。

- `all_or_nothing`: 1行でもinvalidなら何も確定しない
- `partial`: valid rowだけを確定候補にする。skipした行番号を結果へ必ず返す

partial importを暗黙の既定値にはしません。

commit直前には `revalidate` callbackを実行できます。たとえばDry-run後に別利用者が同じbusiness keyを登録した場合、確定前に再検証して止められます。

実際のD1 transaction、batch、optimistic concurrency、idempotency recordは既存のRuntime Integrity / Idempotency基盤とProject Use Case側で接続します。

## 5. 大きなImportを同期HTTPへ閉じ込めない

Templateは特定Queue製品へ固定しません。

`recommendCsvImportExecution()` は、案件で決めたbyte数・row数の閾値から、

- `synchronous`
- `async_job`

を判定できます。

#51 Async Job Foundationが採用されたProjectでは、この境界からJobへ引き渡します。

## 6. CSVを1行ずつstream出力する

`createCsvExportStream()` は全件を1つの巨大stringへ組み立てず、header → row → row... の順で `ReadableStream<Uint8Array>` を生成します。

```ts
createCsvExportStream(
  rows,
  [
    { header: "id", select: (row) => row.id },
    { header: "name", select: (row) => row.name },
  ],
  { formulaProtection: "prefix_single_quote" },
);
```

Exportするfieldはcolumnsで明示します。Domain objectをそのままCSV化しないため、secret / internal-only / PIIを意図せず追加しにくくします。

PIIのmask / omitが必要な場合は #74 Data Maskingを適用した値を `select()` から返します。

## 7. CSV数式注入を防ぐ

SpreadsheetでCSVを開くと、利用者入力が `=`, `+`, `-`, `@` などで始まる場合に数式として解釈されることがあります。

本Templateではstring cellに対して2方式を明示的に選びます。

- `prefix_single_quote`: 先頭へ `'` を付け、文字列として扱わせる
- `reject`: 数式に見える値をExport自体で拒否する

保護を無効にするmodeはBaselineとして提供しません。

number / booleanは型として明示された値のみ通常出力します。

## 8. HTTP Exportは認証・権限確認を先に行う

`createAuthorizedCsvExportResponse()` は次の順番を固定します。

```text
Request
 ↓
Authentication / Authorization
 ↓ allowed
Export対象rowを取得
 ↓
許可されたcolumnsだけCSV化
 ↓
stream Response
```

権限拒否時は `rows()` 自体を呼びません。大量queryやsensitive data生成を権限確認より先に実行しないためです。

HTTP responseは #261 の安全な `Content-Disposition` を再利用し、次を設定します。

- `Content-Type: text/csv; charset=utf-8`
- safe `Content-Disposition`
- `Cache-Control: private, no-store`
- `X-Content-Type-Options: nosniff`
- `X-Request-Id`

## Audit / Evidence

Export完了時の `onComplete` にはrow countとrequestIdのようなbounded metadataだけを渡せます。

CSV本文、PII、secret、認証情報を通常Log / Auditへそのまま保存しません。

Importでも、必要なAuditは以下のようなmetadataを推奨します。

- action
- requestId
- actor / scope
- total / valid / invalid row count
- commit mode
- success / failure

CSV本文全体をAudit evidenceとして残す設計にはしません。

## Out of Scope

- Product固有column mapping
- Excel macro / style / merged cell
- PDF帳票レイアウト
- ETL / Data Warehouse製品
- 巨大データの分散処理
- Object Storage管理
- malware scanner
- universal import transaction policy
- universal partial-import policy

Excel対応が必要なProjectでは、CSV contractへExcel固有概念を混ぜず、別Parser Adapterとして追加します。

## 設計原則

- CSV Uploadと添付ファイル保存を同一責務にしない
- invalid rowを黙ってskipしない
- Dry-runをcommit済みと扱わない
- commit前に再validationできるようにする
- partial importを暗黙選択しない
- Product固有column名をCoreへ固定しない
- Export対象fieldを明示する
- Authorization前にExport queryを開始しない
- CSV formula injectionを無視しない
- 大量処理を同期HTTP requestへ無制限に閉じ込めない
- Local/TestでRemote Object Storageや外部Queueを必須にしない
