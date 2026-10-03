# Email Delivery Recipe

## Use when

認証、Invitation、Password Reset、Magic Link、システム通知などでtransactional emailを送るとき。

## Inputs

- 利用するEmail Provider
- sender address / sender name
- reply-to address / name
- Preview / Productionの送信domain
- 宛先を決めるAuthorization rule
- 失敗時に業務処理を止めるか、後からRetryするか
- Retryする場合の重複許容・idempotency方針
- quota / rate limit /料金条件

## Stop Conditions

以下が未決定ならProduction送信へ進まない。

- sender domainの所有・認証状態
- Production binding / API credential管理方法
- 本番宛先の制限方針
- tokenを含む本文の生成場所とLog禁止境界
- DB更新とメール失敗時の業務状態
- Retry時の重複送信リスク

## Steps

1. `docs/EMAIL_DELIVERY.md`を確認する
2. Application/Use Caseから`EmailProvider`経由で呼ぶ
3. Local/Testは`InMemoryEmailProvider`を使う
4. sender / reply-toは`createEmailDeliveryConfig()`へ設定から注入する
5. 宛先はAuthorization済みUse Caseで決定する
6. Password Reset / Magic Link / Invitation tokenをLog/Auditへ渡さない
7. Cloudflare採用時だけcomposition rootで`CloudflareEmailProvider(env.EMAIL)`を組み立てる
8. `send_email` bindingは採用ProjectのWrangler設定へ追加する
9. 必要に応じてbinding側のsender / destination restrictionも設定する
10. Retryが必要なら#51 Async Jobと組み合わせ、Provider内部で無制限Retryしない

## Validation

### Local / CI

- plain text送信
- HTML送信
- sender / reply-to注入
- malformed address拒否
- CR/LF header injection拒否
- 本文なし拒否
- InMemory Providerから外部送信が発生しない
- Cloudflare message mapping
- Provider error mapping
- safe metadataにaddress / subject / body / tokenが含まれない

### Preview

Human Gate後に必要な場合だけ確認する。

- sending domainがonboard済み
- Preview bindingがPreview用設定を参照
- test recipientへ実送信
- sender / reply-to / plain text / HTML表示
- rate limit / provider error時のUse Case挙動
- Log / Auditに本文・token・addressが残っていない

### Production

Production実送信はRelease手順・Human Gateの対象。

- Production domain / binding / sender restriction
- 宛先誤送信防止
- quota / cost
- notification重複時の影響
- provider障害時の業務継続方針

## Evidence

- PR / CI結果
- 採用Providerと設定責務
- Preview実送信を行った場合の結果（本文やaddress自体はEvidenceへ残さない）
- Production設定変更を行った場合のRelease Evidence

## Do Not

- Application/Domainから`env.EMAIL`を直接呼ぶ
- メールを使わないProjectへCloudflare Email Serviceを強制する
- password / token / Cookie / SessionをLogへ出す
- subject / body / recipientを通常Logへ丸ごと残す
- user inputをsenderへそのまま使う
- Provider内部で無制限Retryする
- 未知の送信失敗を無条件で自動Retryする
- メール送信成功をDB transaction成功と同一視する
- Preview設定をProductionへ暗黙fallbackする
