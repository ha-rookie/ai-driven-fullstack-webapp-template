# ブラウザからファイルを安全に受け渡す共通境界

## 目的

PDF・画像・添付資料などをブラウザからUpload / Downloadするときに、毎回Project側で安全対策を作り直さなくてよいよう、HTTP境界を共通化する。

この設計は **保存場所そのものを作る機能ではない**。

```text
#52 Object Storage
  ファイル本体をprivateに保存する
        ↓
#261 File Transfer HTTP Boundary
  ブラウザとのUpload / Downloadを安全にする
        ↓
Project固有 添付ファイル機能
  所有者・業務状態・表示名・権限・画面を決める
```

## できること

### Upload

- `multipart/form-data` を受け取る
- request全体の最大byte数をProject側で設定する
- `Content-Length`だけでなく、実際に流れてくるbyte数も数えて上限を超えたら停止する
- 1ファイルあたりの最大byte数をProject側で設定する
- 1回に送れるファイル数をProject側で設定する
- 許可するMIME typeをProject側で設定する
- 危険なfilenameを拒否する
- empty fileを拒否する
- 認証・認可に失敗したrequestでは、ファイルbodyを読み始めない
- 保存途中で複数ファイルの一部だけ成功した場合、先に保存した分をbest-effortで補償削除する

### Download

- 認証・認可が終わるまでObject Storageへアクセスしない
- clientから渡されたStorage key/pathをそのまま使わない
- StorageのstreamをそのままHTTP responseへ流す
- `Content-Type`を安全な値へ正規化する
- `Content-Disposition`を安全に生成する
- Unicode filenameはRFC 5987形式の`filename*`で扱う
- Header Injectionを防ぐ
- `Cache-Control: private, no-store`
- `X-Content-Type-Options: nosniff`
- 403を404へ隠すかどうかをProject側で選べる

## 推奨する処理順

UploadのMutationでは、概ね次の順序を維持する。

```text
Origin / CORS
    ↓
Rate Limit
    ↓
Authentication
    ↓
Authorization
    ↓
CSRF
    ↓
File Transfer HTTP Boundary
    ↓
Object Storage
    ↓
Domain metadata / Audit
```

重要なのは、**認証・認可が通る前に大きなbodyを読み始めない**こと。

`readAuthorizedMultipartUpload()` は認可callbackを先に実行し、拒否されたrequestではbodyを解析しない。

ただし実Projectでは、既存のAuthentication / Authorization / CSRF Guardをroute composition側で先に実行する方法を推奨する。

## Upload policy

`FileTransferPolicy`でProjectごとに次を決める。

```ts
{
  maxRequestBytes: 10 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxFileCount: 3,
  allowedMediaTypes: ["application/pdf", "image/*"]
}
```

Templateへ「PDFは10MBまで」等の固定値は埋め込まない。

### MIME typeについて

Browserから送られるMIME typeは**安全性の証明ではない**。

この共通境界のallowlistは、明らかに不要なtypeを早期拒否するための入口であり、ファイル内容が本当にPDFか、malwareを含まないかまで保証しない。

内容検査が必要なProjectでは別途、magic bytes / malware scan / quarantined state等を設計する。

## Multipartのメモリ境界

このTemplateではWeb標準の`FormData` parserを利用するが、その前段でrequest bodyを`ReadableStream`として読み、実byte数を数える。

```text
Browser body stream
  ↓ actual byte count
bounded stream
  ↓
FormData parser
```

したがって**設定上限を超えるrequestを無制限に読み込まない**。

一方で、Web標準multipart parser自体がbounded requestを解析する過程で内部bufferを利用する可能性はある。この方式はProjectが明示的に決めたboundedな添付ファイル向けであり、数百MB〜GB級やresumable uploadの万能解ではない。

大容量file / resumable upload / direct-to-storage uploadが必要なら、別Architectureを採用する。

## File bodyをStorageへ渡す方法

multipart解析後の`File`は、Storageへ保存するときに`File.stream()`を渡す。

```text
File.stream()
   ↓
ObjectStorage.put()
```

Project codeが不要に`arrayBuffer()`へ変換して巨大なbinaryを二重保持する設計は避ける。

## Filenameの扱い

filenameは**表示情報**であり、Storage identifierではない。

拒否する例:

- `../../secret.pdf`
- `folder\\secret.pdf`
- CR / LFを含むHeader Injection候補
- NULやcontrol character
- `.` / `..`
- Project上限を超える長すぎる名前

Unicode filename自体は許可できる。

Object Storageには#52のserver-generated opaque identifierを使う。

## Text fieldを混ぜない理由

共通`readMultipartUpload()`はfile partだけを受け付け、text fieldが混在するmultipartは拒否する。

理由は、Project固有の業務metadataを「file parserのついで」に無検証で取り込まないため。

所有者、説明、分類、申請ID等はProjectのDomain / API validationで扱う。

## 複数fileのpartial success

複数fileを順番にStorageへ保存している途中で失敗した場合、すでに保存済みのfileはbest-effortで削除する。

ただしStorage削除自体も失敗し得るため、これだけで完全なatomic transactionにはならない。

```text
Upload 1 success
Upload 2 failure
   ↓
Upload 1 compensating delete
   ↓ delete failureなら
orphan cleanup対象
```

#52で定義したorphan cleanup / pending state / lifecycle設計は引き続き必要。

## Download authorization

`createAuthorizedDownloadResponse()`へ渡すresolverは、client入力から直接Object identifierを組み立ててはいけない。

推奨:

```text
public document ID
   ↓
DB metadata取得
   ↓
Authentication / Authorization
   ↓
内部ObjectIdentifierを解決
   ↓
ObjectStorage.get()
```

Storage keyを知っていること自体を権限とみなさない。

## ForbiddenとNot Found

Projectによっては「そのfileが存在する」こと自体を権限のない利用者へ知らせたくない。

その場合は`hideForbiddenAsNotFound`で403を404として返せる。

この方針はProjectのSecurity Requirementで決める。

## Download header

基本形:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="download.pdf"; filename*=UTF-8''...
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
X-Request-Id: ...
```

filenameはHeaderへそのまま挿入しない。

## Error contract

file transfer固有errorも既存の標準Error Envelopeへ合わせる。

```json
{
  "error": {
    "code": "payload_too_large",
    "message": "Upload request exceeds the allowed size"
  },
  "requestId": "..."
}
```

代表例:

| 状況 | HTTP |
| --- | ---: |
| malformed multipart / unsafe filename / empty file | 400 |
| authentication required | 401 |
| forbidden | 403 |
| missing / hidden forbidden | 404 |
| storage conflict | 409 |
| request / file too large | 413 |
| unsupported MIME | 415 |
| storage unavailable | 503 |

Provider固有error messageは利用者へ返さない。

## Log / Audit

通常Log / Auditへ次を残さない。

- file binary
- request body全文
- private Storage key/path
- credential / token
- signed URL

必要なら次のような安全なmetadataのみをProject側で記録する。

- requestId
- operation category
- success / failure
- byte sizeのbounded bucket
- media category
- business resource ID

表示filenameに個人情報が含まれるProjectでは、filename自体をLogへ残さない判断を優先する。

## Local / Test

#52の`InMemoryObjectStorage`と組み合わせれば、Remote Object Storageを使わずにUpload保存・Downloadを検証できる。

通常PR CIからProduction bucketへ接続しない。

## Out of Scope

- CSV / Excelの業務データImport / Export
- resumable upload
- multipart object upload最適化
- direct-to-R2 / presigned uploadの実装固定
- malware scanner製品固定
- PDF / Office preview
- image resize / thumbnail
- Product固有Document Management System

## Projectで決めること

- max request bytes
- max file bytes
- max file count
- MIME allowlist
- filename長
- inline表示を許可するか
- forbiddenを403/404のどちらで見せるか
- malware / content validation
- upload後のDomain metadata transaction
- orphan cleanup
- retention / deletion
- quota / cost threshold
- Production bucket / binding / lifecycle
