# FILE_TRANSFER_HTTP Recipe

## 使う場面

ブラウザからPDF・画像・添付資料等をUpload / DownloadするProject機能を追加するときに使う。

保存先そのものは`OBJECT_STORAGE.md`、権限設計は`AUTHORIZATION_BOUNDARY.md`を併用する。

## Inputs

着手前に少なくとも次を決める。

- 対象の業務resource / public ID
- Upload / Downloadを許可する利用者・permission
- `maxRequestBytes`
- `maxFileBytes`
- `maxFileCount`
- MIME allowlist
- filename長上限
- forbiddenを403で返すか404へ隠すか
- Domain metadataの保存方法
- Object Storage provider / binding
- orphan cleanup方針
- malware / content scanの要否

## Stop Conditions

次の場合はAI/Automationだけで先へ進めない。

- Production bucket / binding作成・変更が必要
- Production lifecycle / retention / bulk deleteを変更する
- Public bucket化が必要
- signed URLやcredentialを新規発行する
- 大容量direct upload / resumable uploadが必要だがArchitecture未決定
- ProjectのAuthorization scopeが未決定
- malware scan必須要件があるが処理方式・失敗時状態が未決定

## Steps

1. `../FILE_TRANSFER_HTTP.md` と `../OBJECT_STORAGE.md` を読む
2. Upload / DownloadのResource ScopeとAuthorizationをProject側で決める
3. `FileTransferPolicy`へProject上限とMIME allowlistを設定する
4. Upload routeではOrigin/CORS・Rate Limit・Authn・Authz・CSRFをFile parserより先に実行する
5. `readMultipartUpload()` または `readAuthorizedMultipartUpload()` でbounded multipartを解析する
6. 業務metadataは別のDomain validationを通す
7. `storeParsedUploadFiles()` またはProjectのUse Caseから`ObjectStorage.put()`へstreamを渡す
8. multi-step失敗時のpending / compensation / orphan cleanupを実装する
9. Downloadはpublic resource IDからDB metadataを解決し、Authn/Authz後に内部ObjectIdentifierを得る
10. `createAuthorizedDownloadResponse()`でprivate stream responseを生成する
11. file body / Storage key / credential / signed URLをLog/Auditへ入れていないことを確認する

## Validation

Local / CI:

- valid multipart
- missing / malformed multipart boundary
- Content-Lengthによる早期413
- streamed actual byte countによる413
- file size limit
- file count limit
- empty file
- unsupported MIME
- unsafe filename / CRLF / traversal
- unauthorized requestでbodyを読まない
- unauthorized downloadでStorageへ触らない
- 403 / hidden 404 policy
- safe Content-Disposition
- private/no-store/nosniff headers
- Storage 503 mapping
- partial storage failure時のcompensation
- InMemoryObjectStorageでRemote不要のround-trip

Remote:

- 実Object Storageを使う確認はProjectがPreview resourceを設定しHumanが明示実行する
- Productionへ通常PR CIから接続しない

## Evidence

PRへ残す。

- 採用したsize / count / MIME policyの場所
- Authorization boundary
- negative-path test結果
- Local/CIで使ったStorage adapter
- Preview確認をした場合は対象environmentと実行記録
- Production未確認なら未確認と明記

## Do Not

- JSON Body Guardへmultipartを混ぜる
- Frontendのfile validationだけで安全と扱う
- filename / extension / claimed MIMEだけで安全と扱う
- client filename/pathをObject keyへ使う
- Storage keyを知っているだけでAuthorization済みと扱う
- Authn/Authz前にfile bodyを読み始める
- 無制限のrequest bodyを`arrayBuffer()`へ展開する
- file body / token / signed URL / private keyをLogへ出す
- Upload成功だけでDomain metadataとのatomicityが保証されたとみなす
- compensating deleteだけでorphanが絶対残らないとみなす
- Public bucketを共通baselineにする
