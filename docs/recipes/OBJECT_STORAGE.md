# ファイル保存基盤を導入する（Object Storage Recipe）

## Use when

PDF、画像、添付資料、生成帳票等をD1とは別のprivate Object Storageへ保存するProject。

## Inputs

実装前にProject側で最低限決める。

- 保存対象の種類
- Objectと業務metadataの所有関係
- Preview / ProductionのStorage resource
- retention / delete policy
- overwrite / replace要件
- maximum file size
- malware scan要否
- temporary access / signed URL要否
- quota / cost監視要否

## Stop Conditions

以下が未決定ならProduction設定へ進めない。

- Production bucket / binding
- Public accessを必要とする理由
- retention / deletion
- Authorization boundary
- signed URLを採用する場合の有効期限・配布条件

Remote / Production resource作成・binding変更・bulk deleteはHuman Gate。

## Steps

1. `../OBJECT_STORAGE.md` を読み、D1 metadataとbinaryの責務を分ける
2. Server側でgenerated opaque identifierを作る
3. Local/Testは `InMemoryObjectStorage` でcontractを検証する
4. Cloudflare ProjectでR2を採用する場合は `R2ObjectStorage` をAdapterとしてComposition Rootから注入する
5. Preview / Productionを別resourceへ分離する
6. HTTP Upload / Downloadが必要なら #261のboundaryを組み合わせる
7. multi-step failure時のpending / compensation / orphan cleanupを決める
8. retention / deleteを #46 Data Lifecycleと整合させる
9. 必要ならmalware scan hookを設計する
10. Production resource変更前にHuman Gateで止める

## Validation

- generated identifier以外のpathをStorage keyへ使っていない
- overwrite forbiddenが既定動作
- replaceが必要ならETag等のpreconditionを使う
- Local/TestがRemote bucketなしでgreen
- PreviewとProductionのbindingが分離されている
- binary / credential / signed URLをLog/Auditへ残していない
- metadataだけ成功、binaryだけ成功の不整合ケースを扱える
- delete / orphan cleanupがProject lifecycleと一致している

## Evidence

PRへ残すもの:

- 採用ProviderとAdapter
- Preview / Production分離方針
- metadata / binary配置
- overwrite policy
- lifecycle / orphan handling
- scan / temporary accessの採否
- Local/CI validation結果

Production bucket名やcredential、signed URLそのものをEvidenceへ貼らない。

## Do Not

- client filenameをObject keyへ直結しない
- Public bucketを既定にしない
- Object keyだけでAuthorizationしない
- D1へ大きなbinaryを安易に保存しない
- Upload成功だけで業務処理完了とみなさない
- PreviewからProduction bucketへfallbackしない
- signed URLを通常Logへ出さない
- scanner未実装なのにMIME/拡張子だけで安全と判断しない
