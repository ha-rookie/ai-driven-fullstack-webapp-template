# 時間のかかる処理・定期処理を安全に裏側で実行する仕組み

## 目的

画面からのHTTPリクエストの中ですべての処理を終わらせるのではなく、時間がかかる処理や再試行したい処理を**Jobとして裏側へ渡して実行する**ための共通基盤です。

たとえば次のような処理で使います。

- 大量CSV取込
- メール一括送信
- 外部APIとの連携
- 定期集計
- 夜間処理
- PDF等の生成
- 一時的な外部障害があったときの再試行

```text
画面 / API
   ↓
権限確認・入力確認
   ↓
Jobを作る
   ↓
Queue等へ渡す
   ↓
裏側のWorkerが受け取る
   ↓
重複確認 → 実行 → 完了 / Retry / 停止
```

GitHub上の技術名は **Async Job Foundation (#51)** です。

## この基盤でできること

### 1. 処理をHTTPリクエストから切り離す

`AsyncJobEnvelope` は、裏側へ渡す処理を共通形式にします。

主な情報は次です。

- `jobId`: Job自体の識別子
- `type`: 何のJobかを表す公開token
- `idempotencyKey`: 同じ業務処理を二重実行しないための識別子
- `requestedAt`: Job作成時刻
- `correlationId`: 元のrequest等と関連付ける任意ID
- `payloadFingerprint`: payloadが途中で変わっていないか確認するSHA-256
- `payload`: Jobが必要とする明示的な業務入力

Queue provider固有のmessage形式をCoreへ持ち込みません。

## 2. Queueが同じJobを複数回届ける前提で動く

Queueは「必ず1回だけ届ける」とは扱いません。

同じJobが複数回配送されても、`idempotencyKey`と永続Job状態を使って次を判定します。

- すでに完了済み → 再実行しない
- 別Workerが実行中 → 後で再試行
- Retry待ち → 指定時刻までは実行しない
- 失敗確定済み → 再実行しない
- 同じidempotencyKeyなのにJob内容が違う → conflictとして停止

**exactly-once deliveryは前提にしません。**

## 3. 別Workerで同時実行されるのをleaseで防ぐ

Job実行時には一定時間だけ有効なleaseを取得します。

```text
Worker A ── lease取得 ── 実行中
Worker B ── 同じJob受信 ── lease中なので実行しない
```

leaseには期限があります。

Worker Aが途中で停止した場合、lease期限後に別WorkerがJobを引き継げます。

一方、期限切れ後に古いWorkerが完了を書き込もうとしても、lease tokenが一致しなければ完了扱いにできません。

## 4. Job状態をD1へ残せる

Production向けReferenceとして `D1AsyncJobStateStore` を用意します。

D1の `async_job_runs` には次のような**実行管理情報だけ**を保存します。

- environment
- jobId
- job type
- idempotency key
- payload fingerprint
- state
- attempt回数
- lease期限
- 次回Retry時刻
- 進捗率
- failure code
- 開始・更新・完了時刻

**Job payload本文はD1の状態テーブルへ保存しません。**

認証token、Cookie、password、業務データ本文などを「運用状態を見るため」という理由で永続化しないためです。

Local/Testでは `InMemoryAsyncJobStateStore` を使えるため、Remote D1を必須にしません。

## 5. 一時的な失敗をRetryできる

Retry policyとして次をProject側で決めます。

- 最大試行回数
- 最初の待ち時間
- 最大待ち時間
- 待ち時間の増加率

例:

```text
1回目失敗 → 1秒後
2回目失敗 → 2秒後
3回目失敗 → 4秒後
...
```

待ち時間には上限を設けます。

### Retryする失敗 / しない失敗を分ける

たとえば、

- 外部APIが一時的に応答しない → Retry候補
- 一時的なDB接続失敗 → Retry候補
- 入力された業務command自体が不正 → Retryしない
- 対象が存在せず今後も成功しない → Retryしない

のようにProject側のHandlerが分類します。

分類しない例外は安全側で一時エラーとして扱い、設定回数までRetryします。

## 6. 最大回数を超えたJobを止める

Retry可能な失敗でも最大試行回数を超えた場合、状態を `dead_letter` として止めます。

これはTemplate内の**dead-letter相当の永続状態**です。

Cloudflare Queues自体のDLQ設定とは別です。実ProjectでNative DLQも利用する場合は、Queue側設定とこの状態管理を組み合わせます。

無限RetryをBaselineにはしません。

## 7. 進捗を残せる

Handlerは0〜100の整数で進捗を報告できます。

```text
10%  読み込み
35%  入力確認
70%  更新処理
100% 完了
```

任意の`code`も付けられますが、長いメッセージや業務データ本文を入れる用途ではありません。

画面で進捗表示するProjectでは、この状態をAPIから読み出す専用Use Caseを追加できます。

## 8. 定期処理の二重起動を防ぎやすくする

`createScheduledJobIdentity()` は、

- schedule名
- 本来の実行予定時刻

から同じ識別子を作ります。

たとえば同じ「日次集計 2026-10-03 03:00」が何らかの理由で2回起動されても、同じ`idempotencyKey`になります。

```text
scheduled:daily-report:2026-10-03T03:00:00.000Z
```

Cron eventを受け取った時刻そのものではなく、**同じ予定回を同じidentityとして扱う**ことが重要です。

## 9. Cloudflare Queuesへ接続できる

`CloudflareQueueAsyncJobPublisher` をReference Adapterとして用意します。

CoreのJobをCloudflare Queueへ送り、Retry時のmillisecond指定をQueueのdelay secondsへ変換できます。

Consumer側では `consumeCloudflareQueueMessage()` が実行結果に応じて、

- 完了 → `ack`
- すでに完了 → `ack`
- Retry → `retry`
- 他Workerがlease中 → `retry`
- Retry時刻前 → `retry`
- terminal failure / dead-letter相当 → `ack`して運用状態に残す

という境界を作ります。

Template CoreをCloudflare Queues専用にはしていません。

## Job payloadの安全境界

Job payloadは通常のHTTP RequestやSessionそのものではありません。

`createAsyncJobEnvelope()` はBaselineとして次を拒否します。

- `authorization`
- `cookie`
- `credential`
- `password`
- `secret`
- `session`
- `token`
- `signed_url`相当

また、

- plain JSON以外
- Date objectをそのまま渡す
- function
- BigInt
- 非有限number
- 過度に深いobject
- Project設定を超えるpayload size

も拒否します。

Date等が必要なら、Project側でISO文字列等へ明示変換してから渡します。

このkey検査は**機密情報を完全に自動判定できる保証ではありません**。payloadには必要最小限の明示DTOだけを入れることが正本です。

## payload改ざん検知

Job作成時にJSONをkey順で正規化し、SHA-256 fingerprintを作ります。

Consumerは実行前に再計算します。

Queue内やAdapter境界でpayloadが意図せず変わった場合、Handlerを呼ぶ前に停止します。

SHA-256 fingerprintは暗号化ではありません。payloadの秘密保持はQueue / Runtime側の責務です。

## Authorizationの扱い

**HTTP SessionをJobへそのまま渡しません。**

推奨フロー:

```text
HTTP Request
 ↓
Authentication
 ↓
Authorization
 ↓
許可された業務Commandを作る
 ↓
必要最小限のJob payloadへ変換
 ↓
Queue
```

Job実行時にも現在の権限状態を再確認する必要がある業務では、consumer側で再Authorizationします。

「依頼時に許可されていたから、数時間後も必ず許可する」というルールをTemplateは固定しません。

## 業務更新そのものの二重実行対策

Job leaseだけで、業務DB更新まで完全にexactly-onceになるわけではありません。

例:

```text
業務DB更新 成功
 ↓
Worker停止
 ↓
Job完了記録 未実施
 ↓
Queueから再配送
```

この場合、Jobは再実行されます。

したがって実際のHandlerでは、既存のIdempotency / optimistic concurrency / transaction等を使い、**業務更新自体も再実行可能にする**必要があります。

Job leaseは「同時実行を減らす仕組み」であり、業務transactionの代替ではありません。

## Queue登録とDB更新の非原子性

次の2つは自動的には1 transactionになりません。

```text
業務DBを更新する
QueueへJobを送る
```

DB更新だけ成功してQueue送信前に停止する可能性があります。逆もあります。

このTemplateでは、この問題を隠して「原子的に成功した」ことにはしません。

厳密な整合性が必要なProjectでは、たとえばTransactional Outbox等の別設計を追加します。

## Environment分離

D1 Job Stateは `environment + idempotencyKey` で分離します。

PreviewのJob状態をProductionへfallbackしません。

Cloudflare Queueのbinding / Queue resource自体もPreviewとProductionで分離することを原則とします。

## Audit / Log / Monitoring

通常Logへ残す候補:

- job type
- state transition
- attempt
- bounded failure code
- correlationId
- duration

通常Logへ残さないもの:

- Job payload本文
- password / token / Cookie
- Session情報
- private file body
- CSV本文
- signed URL

重要な業務処理ではDurable Auditも組み合わせます。

## Productionで必要な追加設定

今回のFoundationはCode / Migration / Adapterまでです。

実ProjectでCloudflare Queuesを利用する場合は別途Human Gateのもとで、

- Queue resource作成
- Preview / Production binding
- consumer設定
- retry / batch / concurrency設定
- 必要ならDLQ
- Cron Trigger
- quota / cost確認
- 実Preview smoke
- Production deploy

を行います。

今回の実装ではProduction Queue作成やbinding変更は行いません。

## Out of Scope

- Product固有batch
- universal workflow engine
- long-running compute platform
- Queue resource自動作成
- universal concurrency値
- universal retry回数
- universal Cron schedule
- Job payloadの長期保存
- exactly-once保証
- QueueとD1の分散transaction
- Transactional Outboxの標準実装
- Production Queue操作

## 設計原則

- exactly-once deliveryを前提にしない
- duplicate deliveryを通常ケースとして扱う
- Job状態の正本をWorker process memoryだけにしない
- payloadにSession / credentialを入れない
- payload本文を運用状態DBへ保存しない
- 同じidempotencyKeyで内容が違えば停止する
- lease期限切れWorkerが完了状態を上書きできないようにする
- Retryを無限に続けない
- scheduled jobは予定回単位でidentityを固定する
- Job leaseを業務transactionの代替にしない
- Queue publishとDB mutationを原子的だと偽らない
- PreviewからProductionへ状態・Queueをfallbackしない
- Remote / Production resource変更はHuman Gateを維持する
