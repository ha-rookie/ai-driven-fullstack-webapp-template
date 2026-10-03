# ファイルを安全に保存する共通機能（Object Storage Foundation）

## 目的

PDF、画像、添付資料、Excel / CSV原本、生成帳票などの**バイナリデータをD1へ無理に保存せず、privateなObject Storageへ分離するための共通基盤**です。

このFoundationは「どこへ保存するか」を担当します。

- Upload / DownloadのHTTP受付・返却は #261 File Transfer HTTP Boundary
- CSV等の業務データ取込・出力は #262 Data Import / Export Foundation
- 「誰がそのファイルを見てよいか」はAuthorization側
- ファイルに紐づく業務情報・所有者・表示名・状態はProject側のD1 / Domain metadata

という責務分離を維持します。

## 利用者から見た機能

たとえば業務画面で「見積書PDFを添付する」機能を作る場合、次のように分けます。

```text
D1 / Domain metadata
- 誰のファイルか
- どの案件に属するか
- 表示用ファイル名
- MIME type
- byte数
- Object identifier
- lifecycle state

Object Storage
- PDFそのもののbinary
```

利用者が送った `見積書.pdf` という名前を、そのまま保存先のObject keyにはしません。

Server側で生成したopaqueなIDを使います。

```text
objects/preview/550e8400-e29b-41d4-a716-446655440000
objects/production/550e8400-e29b-41d4-a716-446655440000
```

表示用ファイル名はD1等のmetadataとして別に持ちます。

## 共通契約

`src/shared/object-storage/` に以下を実装します。

### ObjectStorage

- `put()` — 保存
- `get()` — binary付きで取得
- `head()` — binaryを読まずmetadataだけ取得
- `delete()` — 削除。存在しないObjectへのdeleteはidempotentに扱う

### Object identifier

`createObjectIdentifier()` でServer側の `IdGenerator` からopaque IDを生成します。

Client filenameやclient supplied pathはObject identifierとして信用しません。

`/` や `..` を含む値は共通validationで拒否します。

### 上書きルール

既定値は **上書き禁止** です。

```text
overwrite omitted / forbid
→ 同じidentifierが存在すれば already_exists

replace
→ 明示した場合だけ置換可能

replace + ifMatchEtag
→ 現在のETagが一致する場合だけ置換
```

意図しない同名Objectの上書きを既定動作にしません。

## Local / Test

`InMemoryObjectStorage` を使うことで、Local/TestではRemote R2を必要としません。

- Uint8Array
- ArrayBuffer
- ReadableStream<Uint8Array>

を保存入力として扱えます。

保存時にはSHA-256をLocal ETagとして生成し、条件付き置換のtestにも利用できます。

これはProduction Storageの代替ではなく、Provider-neutral contractを高速に検証するためのTest Adapterです。

## Cloudflare R2 Reference Adapter

`R2ObjectStorage` をReference Adapterとして提供します。

Core contractはR2型へ依存せず、R2固有型はAdapter内部だけで扱います。

Project側ではWorker bindingを明示的に渡します。

```ts
const storage = new R2ObjectStorage({
  environment: "preview",
  bucket: env.PRIVATE_OBJECTS,
});
```

Templateは具体的なR2 bucket名やbinding名を固定しません。

## private-by-default

このFoundationはPublic bucketや公開URLを作りません。

- R2 bucketはprivate前提
- Object keyを知っているだけで権限があるとは扱わない
- Download前にtrusted server-side boundaryでAuthorizationする
- Public CDN hostingをTemplate標準にしない

### 一時URL / signed URL

`TemporaryObjectAccessProvider` を別capabilityとして定義しています。

これは「Storage Providerが一時Read URLを作れる場合に、追加実装できる」という境界です。

R2 Worker binding Adapterは、認証情報なしで公開URLを捏造しません。ProjectがS3-compatible API等で署名URLを採用する場合に、別Adapterとして実装します。

署名URLはcredential相当として扱い、通常のApplication Log / Auditへ残しません。

## Preview / Productionの分離

Object keyにはEnvironment prefixを付けますが、**prefixだけで環境分離が十分とは扱いません**。

Projectでは原則としてPreview / Productionで別Bucketまたは別Bindingを利用します。

```text
Preview Worker
  → Preview private bucket

Production Worker
  → Production private bucket
```

Environment prefixは誤接続時の追加防御です。

Production bucketをPreviewへfallbackしません。

## metadata

Object Storage側のmetadataは最小限にします。

共通で扱うもの:

- `contentType`
- bounded custom metadata

Custom metadata keyはlower-caseの安全な形式に限定し、次のような秘密情報を示すkeyを拒否します。

- authorization
- cookie
- password
- secret
- token
- signed_url

Binary本体、Token、署名URL、Cookie等をmetadataへ保存しません。

Project固有の業務metadataは原則D1 / Domain側へ置きます。

## エラー

Provider固有のerrorをそのままApplicationへ漏らしません。

共通error code:

- `invalid_identifier`
- `invalid_metadata`
- `already_exists`
- `precondition_failed`
- `unsupported`
- `provider_error`

Providerのraw error message、bucket名、credential、署名URL等を利用者向けerrorへ含めません。

## lifecycle / orphan cleanup

Object StorageとD1 metadataを1つのatomic transactionにはできないため、multi-step failureを前提にします。

### Upload系の推奨順

Projectの要件に応じて次のどちらかを明示します。

```text
A. metadata reservation
D1でpending metadata作成
→ Object Storage put
→ D1をacceptedへ更新

B. object first
Object Storage put
→ D1 metadata作成
→ metadata失敗時にObjectをcompensating delete
```

どちらも「Object Storageへのput成功 = 業務上の添付完了」とは扱いません。

### orphan

以下をorphan候補として扱います。

- Objectは存在するがD1 metadataがない
- D1 metadataはあるがObjectがない
- upload途中のpending stateが長時間残っている

Cleanup cadenceやretention時間はProject側で決めます。

必要なら #51 Async Job Foundationと組み合わせます。

## 削除・retention・backup

#46 Data Lifecycle / Backup Architectureと整合させます。

Projectで決める事項:

- 業務データ削除時にObjectを即時削除するか
- retentionを置くか
- legal hold等が必要か
- Object versioningを使うか
- Object Storage自体のbackup / replicationが必要か
- orphan cleanupまでの猶予期間

Templateでは一律の日数を固定しません。

## malware scanの境界

このFoundationは特定scannerを内蔵しません。

利用者Uploadを扱うProjectでは必要に応じて、#261のHTTP boundaryとStorageの間にscan stateを設けます。

```text
uploaded / scan_pending
      ↓
scanner
  ├─ accepted
  └─ rejected
```

MIME typeや拡張子だけを「安全なファイル」の根拠にはしません。

## Capacity / Cost

Object StorageはD1と異なるコスト軸を持つため、Projectで次を監視対象にできます。

- object count
- stored bytes
- read / write / delete operation count
- transfer量
- orphan数

Templateでは固定quotaを設けません。

## Security boundary

このFoundationが保証すること:

- provider-neutral Storage contract
- generated opaque identifier
- private-by-default
- overwrite forbidden by default
- conditional replace
- environment-scoped key
- bounded non-sensitive metadata
- provider error abstraction
- Local/Test Adapter
- R2 Reference Adapter

このFoundationだけでは保証しないこと:

- 利用者Authorization
- Upload request size / multipart parsing
- safe filename / Content-Disposition
- malware-freeであること
- metadataとbinaryのatomic commit
- signed URLの安全な配布
- Product固有retention
- Production bucket作成・binding設定

## Human Gate

以下はProject側のRemote / Production操作です。

- Production R2 bucket作成
- Production Worker binding設定
- lifecycle rule変更
- bucket delete
- bulk object delete
- Public access有効化
- Production signed URL credential設定

通常PRのmergeだけでは実行しません。
