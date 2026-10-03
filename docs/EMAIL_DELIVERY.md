# メール送信の共通基盤（Email Delivery Foundation）

## 目的

認証、Invitation、Password Reset、Magic Link、システム通知などから共通利用できる**transactional email送信境界**を提供します。

Template Coreは特定Providerへ固定しません。

```text
Application / Use Case
        ↓
TransactionalEmailService
        ↓
EmailProvider
   ├─ InMemoryEmailProvider       Local / Test
   ├─ CloudflareEmailProvider     Workers Email Service binding
   └─ Project adapter             Resend / SendGrid / SMTP等
```

## 何ができるか

- plain text / HTML transactional email
- sender / reply-to設定の注入
- to / cc / bcc
- named address
- Provider差し替え
- Local/Testで外部送信なし
- Cloudflare Email Service Workers Bindingへの接続
- Provider errorの共通分類
- Log/Auditへ本文・宛先・tokenを残さないsafe metadata

## Baselineに入れないもの

- marketing newsletter / campaign
- unsubscribe管理
- bounce / complaint高度分析
- inbound email / Email Routing
- attachment送信
- Provider内部での無制限Retry
- Production Email Service resource / sending domain作成

添付ファイルはObject StorageやFile Transferとは別責務です。メール添付が必要になった場合は、サイズ・malware scan・保持・Provider制約を含めてProject側で追加設計します。

## Coreの使い方

```ts
const config = createEmailDeliveryConfig({
  fromAddress: env.EMAIL_FROM_ADDRESS,
  fromName: env.EMAIL_FROM_NAME,
  replyToAddress: env.EMAIL_REPLY_TO_ADDRESS,
});

const email = new TransactionalEmailService(provider, config);

await email.send({
  to: "user@example.com",
  subject: "Invitation",
  text: "You have been invited.",
  html: "<p>You have been invited.</p>",
});
```

Application / Domain層は`env.EMAIL`を直接参照しません。

## Local / Test

Local/Testでは`InMemoryEmailProvider`を利用します。外部ネットワークへ送信せず、テスト内で送信内容を確認できます。

```ts
const provider = new InMemoryEmailProvider();
const service = new TransactionalEmailService(provider, config);
await service.send(...);

assert.equal(provider.sent.length, 1);
```

## Cloudflare Email Service Adapter

2026-10-03時点でCloudflare Email SendingはPublic Betaです。Workersからは`send_email` bindingを経由して`send()`できます。

Templateの`wrangler.jsonc`へbindingは標準追加しません。メールを使わないProjectをCloudflare Email Serviceへ依存させないためです。

採用Projectで明示的に追加します。

```jsonc
{
  "send_email": [
    {
      "name": "EMAIL"
    }
  ]
}
```

必要に応じて`allowed_sender_addresses`や`allowed_destination_addresses`でbinding側でも制限してください。

Worker composition rootだけでCloudflare固有bindingをAdapterへ渡します。

```ts
const provider = new CloudflareEmailProvider(env.EMAIL);
const config = createEmailDeliveryConfig({
  fromAddress: env.EMAIL_FROM_ADDRESS,
  fromName: env.EMAIL_FROM_NAME,
  replyToAddress: env.EMAIL_REPLY_TO_ADDRESS,
});
const email = new TransactionalEmailService(provider, config);
```

## Provider Error

Cloudflareの代表的なerror codeは共通errorへ変換します。

- validation / field missing → `invalid_message`
- sender未設定・未認証 → `sender_rejected`
- recipient禁止・suppressed → `recipient_rejected`
- content size超過 → `content_too_large`
- rate / daily limit → `rate_limited`
- delivery failure → `delivery_failed`
- internal error → `provider_unavailable`

未知のProvider errorは`provider_error`かつ`retryable=false`です。

これは意図的です。送信Providerがメールを受理した後に呼出側だけ失敗を観測した可能性があるため、未知エラーを自動Retryすると二重送信になる場合があります。

Retryが必要なUse Caseは、#51 Async Job等の呼出側で**業務上の重複許容・idempotency・通知種別**を判断して実装します。

## Safe Logging / Audit

通常Log / Auditへ以下を残しません。

- 宛先メールアドレス
- sender / reply-to address
- subject
- text / HTML本文
- Password Reset / Magic Link / Invitation token
- Provider raw error message

共通の`toSafeEmailDeliveryFields()`で扱うのは以下だけです。

- recipientCount
- hasText
- hasHtml
- hasReplyTo

相関が必要な場合は既存のrequestId / correlationId / Job ID等を利用し、メール本文を相関キーにしません。

## Security Boundary

- Email validationはAuthorizationの代替ではありません
- 宛先決定前にUse Case側でAuthorizationを完了してください
- user inputをsenderへ直接利用しません
- CR/LF等の制御文字をaddress / display name / subjectへ許可しません
- secret / API tokenをcodeへ埋め込みません
- Local/Testでは実Providerを使いません
- Provider Adapterは無制限Retryしません
- メール送信成功をDB transaction成功の代替にしません
- DB mutationとメール送信をatomicだとは扱いません

## Production Human Gate

以下はTemplate実装完了とは別です。

- sending domain onboarding
- SPF / DKIM / DMARC確認
- Production `send_email` binding追加
- sender / destination restriction設定
- quota / pricing確認
- Preview / Production実送信試験
- 本番通知のRetry /重複許容判断

これらはProject側でHuman Gateを通して実施します。

## Cloudflare公式資料

- https://developers.cloudflare.com/email-service/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- https://developers.cloudflare.com/email-service/configuration/send-bindings/
- https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/
