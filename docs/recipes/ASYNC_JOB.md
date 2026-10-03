# 時間のかかる処理・定期処理を裏側へ移す Recipe

## Use when

次のような処理をHTTPリクエストの中へ閉じ込めたくない場合に使います。

- 大量CSV取込
- 外部API連携
- メール一括送信
- 定期集計
- 夜間処理
- 再試行が必要な処理

設計の正本は `../ASYNC_JOB.md` です。

## Inputs

実装前にProject側で決めます。

- Job type
- payloadに必要な最小項目
- idempotency keyの意味
- 最大payload size
- lease時間
- max attempts
- retry base delay / max delay / multiplier
- retryable / non-retryable error分類
- Handler側の業務idempotency方針
- Job状態を誰が閲覧できるか
- Scheduled Jobの場合のschedule keyと予定時刻
- Cloudflare Queueを採用するか
- Preview / ProductionのQueue分離
- Native DLQを使うか
- Audit対象か

## Stop Conditions

次の場合は自動的に先へ進めません。

- Production Queue resourceを新規作成する
- Production Queue bindingを変更する
- Production Cron Triggerを追加・変更する
- Production Jobを手動投入する
- Production dead-letter相当Jobを再実行する
- 大量Production dataをJobで更新する
- retryによる二重更新を防ぐ業務設計がない
- Queue publishとDB mutationの整合性要件が未定義
- payloadへcredential / session / secretを入れないと実装できない

Remote / Production / destructive operationはHuman Gate対象です。

## Steps — Jobを作る

1. HTTP側でAuthentication / Authorizationを先に終える
2. 業務Commandとして必要な情報だけをJob payloadへ変換する
3. Session / Cookie / Authorization header / tokenをpayloadへ入れない
4. `createAsyncJobEnvelope()` でJobを作る
5. 同一業務Commandの二重実行を防ぐ `idempotencyKey` を決める
6. Queue publisherへ渡す

## Steps — Consumerを作る

1. Queue messageからJob envelopeを受け取る
2. `executeAsyncJob()` でpayload fingerprintを検証する
3. Durable Job Stateからleaseを取得する
4. すでに完了・実行中・Retry待ちならHandlerを呼ばない
5. Handler内で業務更新自体のIdempotency / concurrency controlを適用する
6. 必要なら `reportProgress()` でboundedな進捗を残す
7. 成功時はcompletedへ遷移する
8. 一時失敗はRetryへ遷移する
9. 非再試行エラーはfailedへ遷移する
10. 最大回数超過はdead-letter相当へ遷移する

## Steps — Scheduled Job

1. schedule名を固定する
2. 「実際に受け取った時刻」ではなく「本来の予定時刻」を確定する
3. `createScheduledJobIdentity()` で同じ予定回に同じidentityを付ける
4. 同じCron occurrenceが二重通知されても同じidempotencyKeyになるようにする
5. Handler側の業務idempotencyも維持する

## Steps — Cloudflare Queuesを使う場合

1. Coreは `AsyncJobPublisher` / `AsyncJobStateStore` のまま保つ
2. `CloudflareQueueAsyncJobPublisher` をAdapterとして使う
3. Consumer messageは `consumeCloudflareQueueMessage()` でack / retryへ変換する
4. Preview / Production Queueは分離する
5. Queue binding / retry / batch / concurrency / DLQはProject設定として決める
6. Production resource変更はHuman Gateを通す

## D1 State Store

Production向けReferenceとして `D1AsyncJobStateStore` を利用できます。

Migration `0017_async_job_runs.sql` では、Job payloadではなく次の状態だけを保存します。

- environment
- job / idempotency identifiers
- payload fingerprint
- state
- attempts
- lease
- retry due time
- progress
- failure code
- timestamps

Local/Testでは `InMemoryAsyncJobStateStore` を使います。

## Retry分類例

### Retry候補

- 外部API timeout
- 一時的なrate limit
- 一時的なdependency failure
- lease lost

### Retryしない候補

- 業務Commandが不正
- 必須対象が存在しない
- 既に許可されない状態へ遷移している
- payload conflict

Product固有の分類をTemplate Coreへ固定しません。

## Validation

最低限、以下を確認します。

- Job envelopeがplain JSONだけを許可する
- password / token / cookie / session等のfieldを拒否する
- payload size上限が効く
- payload fingerprint改ざんを検知する
- 同じ完了Jobのduplicate deliveryでHandlerを再実行しない
- active lease中は別WorkerがHandlerを実行しない
- lease期限後は引継ぎ可能
- retry due前は実行しない
- retry delayがpolicy通り増加し、最大値を超えない
- non-retryable errorが即時failedになる
- max attempts超過でdead-letter相当になる
- 同じidempotencyKey + 異なるpayloadがconflictになる
- progressが0〜100に制限される
- Scheduled Jobが同じ予定回に同じidentityを返す
- Cloudflare adapterがack / retryを正しく選ぶ
- D1 migrationがLocalで適用できる
- Preview / Productionを混ぜない

## Evidence

PRには最低限次を残します。

- retry policyのReference値
- lease policy
- state transition test結果
- duplicate delivery test結果
- payload safety test結果
- migration結果
- Full local validation
- lint / build
- Browser E2Eへの影響有無
- Production resource変更を実施していないこと

## Do Not

- Queueだから1回しか届かないと思わない
- Job stateをprocess memoryだけにしない
- Session objectをQueueへserializeしない
- token / password / Cookieをpayloadへ入れない
- Job payload本文を通常Logへ出さない
- Job payload本文を状態確認用DBへ丸ごと保存しない
- lease取得だけで業務更新がexactly-onceになると思わない
- retry可能な業務更新を非idempotentに書かない
- infinite retryを設定しない
- Cron受信時刻だけで毎回別Job IDを作らない
- Queue publishとDB updateが1 transactionだと扱わない
- Preview QueueをProductionへfallbackしない
- Production Queue / Cron / DLQを承認なしで変更しない
