# VAL-INTERNAL-005 — 備品購入承認の再利用スパイク（#475）

**Evidence type: INTERNAL / controlled reuse spike。** 本検証は既存Repository内の小さな購買業務Consumerです。独立した開発者、独立したAI、外部Repository、本番利用や有償採用のEvidenceには数えません。

## 何を確かめるか

**仮説:** WORKHUBの出張申請をコピーしなくても、既存の`WorkflowService`と`authorizeScopedAction`を組み合わせれば、別の業務である備品購入（部門長承認 → 経理承認）に必要な基本の承認・拒否境界を実装できる。

評価対象は**共通部品の再利用可能性**のみ。完成した備品購入システムを構築する試験ではありません。

## 実装範囲

- [Purchasing Consumer](../../examples/reuse/purchase-approval.ts): 購買に固有の型、役割、権限Action、金額チェック、承認者Resolver、二段階承認Definitionを定義し、Template Workflow/Authorizationを直接利用
- [Focused Test](../../tests/purchase-approval-reuse.test.ts): 正常系、他部署Scope、本人とMembership不整合、金額不正、別承認者、古い更新Version、二重Submit、承認者不明、Roleなし
- **既存部品の使用先:** `src/worker/workflow/{service,in-memory-store}.ts`、`src/worker/authorization/policy.ts`
- **出張業務コードのコピー:** なし。WORKHUB固有のTravelRequest Store/Fixtureは参照しない
- **データ:** Local InMemoryのみ、Remote DB/Cloudflare/Preview/Production接続なし

## 実行と証拠

通常のPR CIのunit testコンパイル入口に登録し、`npm run test:unit` を通じて確認します。
`tsconfig.test.json`に`examples/reuse/**/*.ts`を追加し、既存`tests/**/*.ts`収集ルールを維持します。

**成功条件:** 新しい購買ConsumerのテストがPASSし、WORKHUB固有Serviceへの依存や共通Workflow Source変更なしに上記境界を満たす。

## 観測された再利用境界／導入時の追加仕事

| 項目 | スパイクでの状況 | 別案件へ適用する際の追加判断 |
| --- | --- | --- |
| Workflowの状態遷移 | 既存`WorkflowService`を使用 | ステップ数/承認者/条件/差戻し方針 |
| Role/Scopeの判定 | 既存`authorizeScopedAction`を使用 | 誰がどのScopeを持つか、Role/Action設計 |
| 二重SubmitとVersion | 既存`InMemoryWorkflowStore`を使用 | Durable D1 Store、トランザクション境界、Client Idempotency |
| Domain Validation | **新規で必要** | 金額・費目・予算・購買規程等 |
| 責任境界 | **新規で必要** | ログインSessionとMembership解決、server-side guard、担当者Directory |
| 周辺機能 | **未実装** | UI、API、Audit、メール通知、Outbox、添付、帳票、運用/Recovery |
| 業務データとWorkflowの整合 | **未実装** | Business Entityの永続更新との失敗時整合・補償/Recovery |

**解釈:** 共通Workflowはプロセスの状態遷移を提供しますが、購入条件や業務データ永続化の判断はProject側に残ることが分かる構成です。今回のテストだけでは、生産性向上・開発時間短縮・販売可能性は検証できません。

## 計測の限界と今後の検証

今回の内部試作はGitHub上で直接構築しており、**時間短縮率や人手による工数は計測していません**。既存Sourceと新規Sourceの比較から「共通部分を再実装せず直接importした」ことは確認できますが、「他の方法より何分速い」は不明です。

次段階で実利用の証拠にするには、別Repository/別ProjectでAPI/DB/画面を含む小機能を実装し、Template利用あり/なしの作業数・修正回数・判断時間などを同条件で比較する必要があります。その前に、本実験の結果で不足した境界を #475 に還流してください。

本検証はProductの機能リリースではなく、Reusable Foundationの最小移植性検証です。PR合格後でも #475（External Adoption / Usability Validation）はOpenを維持します。

## 追加評価（#475）— Cloudflare非依存の選択的再利用境界

**課題:** 初期スパイクでは `src/worker/workflow` と `src/worker/authorization` の集約indexから読み込んでいた。これらはD1 StoreやHTTP Guardもexportしており、「WorkflowとScoped AuthZだけを移す」最小依存範囲の証明にはならなかった。

**変更:** 購買Consumerを既存のleaf moduleへ直接importする構成にし、別のWorkflow Engine・Authorization抽象化・新しいOSS・外部依存を増やさない。必要な参照は次の**5ファイル**。

- `src/worker/workflow/types.ts`
- `src/worker/workflow/service.ts`
- `src/worker/workflow/in-memory-store.ts`
- `src/worker/authorization/types.ts`
- `src/worker/authorization/policy.ts`

**検証コマンド（既存npm dependenciesを利用）:**

```bash
npm ci
npx tsc -p examples/reuse/tsconfig.portable.json
npm run test:unit
```

Portable typecheckは `types: []` と `ES2023/DOM` のみで、Cloudflare Workers型・Node型・D1環境を読み込まず、購買Consumerのimport依存をコンパイルする。CIはWorkflow/AuthZ/Exampleなど**関連ファイルが変更された場合だけ**この追加typecheckを実行する。正常系や各拒否条件の実行確認は既存6件の購買Unit testを再利用し、重複テストを増やさない。

**観測できること:** 既存コードのうち上記小さな範囲について、Cloudflare固有の型を必要とせず利用できるか。**観測できないこと:** 外部プロジェクトでのパッケージ配布、D1以外のdurable storage、外部開発者が迷わず導入できるか、AWS/AzureでのProduction稼働、実工数短縮。「プラットフォーム非依存の完成品」ではない。

**まだ必要:** 利用先のbuild/distribution、認証SessionとMembership検証、Durable Store・業務データの原子的整合、復旧・監査・通知等。Cloudflareに依存しないことが必要なプロジェクトでは、購入Consumer自体がReferenceとして有用でも、Workflow StoreやRuntime Adapterの実装が別途必要になる。

この追加テストのEvidence区分は **INTERNAL / static portability boundary**。別Repositoryへの採用実績や `DOGFOOD` / `HUMAN` / `AI-REVIEW` 証拠には分類しない。

次の検証段階: [VAL-INTERNAL-010: 別の一時プロジェクトへ必要なファイルだけをコピーし、実行する](VAL-INTERNAL-010_ISOLATED_CONSUMER.md)。こちらも内部の制御された検証であり、外部採用の実績には数えません。
