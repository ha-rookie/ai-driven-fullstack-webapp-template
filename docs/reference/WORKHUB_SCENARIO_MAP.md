# WORKHUB / Admin シナリオ対応表（Issue #433 既存S01–S18）

## 目的・正本

この表は[Issue #433](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/433)の**既存18シナリオ**（S01–S18、既存の`scenario.*` Stable ID）を、現行の公開Showcase・認証後WORKHUB Developer Mode・管理画面・Reference Siteのどこで追えるかに対応付けた案内です。新しい業務機能や18個の公開デモを作るものではありません。

- 業務/設計上のScenario定義・Tierの正本: Issue #433の「WORKHUB / Reference Scenario Inventory v0.1」および「Scenario IDs — v1 inventory」
- 実装済みDeveloper Modeの登録先: [developer-guide.ts](../../src/reference/workhub/developer-guide.ts)、[developer-reference.ts](../../src/reference/workhub/developer-reference.ts)
- 公開ツアーの実際の選択肢: [WorkhubShowcase.tsx](../../src/reference/showcase/WorkhubShowcase.tsx) の `request / return / trace / expense / search`（5段階）および`#showcase-recovery`
- 公開Referenceの代表Capability: [ReferenceSite.tsx](../../src/reference/site/ReferenceSite.tsx) の `workflow / authorization / recovery / search / report / csv`（6件）
- `—` は**この掲載範囲で確認済みの専用リンクがない**という意味です。未実装・失敗・不具合・将来廃止の断定ではありません

**証拠の境界:** 「公開案内」は読み取り専用ツアーであり、ログイン操作を実行した証拠ではありません。「認証後」はDeveloper Mode/業務画面の参照先であり、現在のPreviewへのコード反映を保証しません。模擬・Catalog-only・部分実装と、実Provider/Remote D1/Productionの動作を混同しません。

## 既存18シナリオ → 現行デモ／Reference／根拠

| 台帳 | Stable Scenario ID | 業務の場面 | 分類 | 公開Showcaseの導線 | 認証後WORKHUB／Admin側の対応 | 公開Referenceの代表Capability | 掲載範囲・制約 | 設計Issue |
|---|---|---|---|---|---|---|---|---|
| S01 | `scenario.workhub.travel-approval` | 出張申請→差戻し→再申請→承認 | Business | `return` (公開案内) | `travel-request-settlement` (認証後) | `workflow` / `authorization` | 実装・CI証拠あり。公開ツアーは操作ガイドで実ログイン成功の証明ではない | [#321](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/321) [#332](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/332) |
| S02 | `scenario.workhub.travel-straight-approval` | 出張申請→直接承認 | Business / variation | `request` (公開案内) | `travel-request-settlement` (認証後) | `workflow` | S01の最短Variation。専用の公開完結デモではない | [#332](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/332) |
| S03 | `scenario.workhub.travel-expense` | 出張承認→経費精算→経理確認 | Business | `expense` (公開案内) | `travel-request-settlement` / 経費精算画面 (認証後) | `workflow` | 経費精算の代表UI・E2Eあり。実決済や支払完了は対象外 | [#268](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/268) [#343](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/343) |
| S04 | `scenario.workhub.moving-home` | 引っ越し手続き | Business / Integration | — | `moving-reference` (模擬Workflow) | — | 模擬手続きのみ。実人事データや外部SaaSを更新しない | [#268](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/268) [#343](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/343) |
| S05 | `scenario.workhub.pc-replacement` | PC交換手続き | Business / Integration | — | `pc-replacement-reference` (模擬Workflow) | — | 模擬引継ぎのみ。実IT資産の交換・連携は未実施 | [#268](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/268) [#343](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/343) |
| S06 | `scenario.workhub.employee-onboarding` | 新入社員の各種手続き | Business / Integration | — | `newcomer-onboarding` (Catalog-only) | — | 端から端まで動く業務フローは未登録 | [#268](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/268) [#343](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/343) |
| S07 | `scenario.workhub.ai-usage-request` | AI利用申請 | Business / Security | — | `ai-access-request` (Catalog-only) | — | 構想のみ。申請・権限追加の本番操作を意味しない | [#268](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/268) [#349](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/349) |
| S08 | `scenario.workhub.enterprise-search` | 権限付き横断検索 | Business / Security | `search` (出張申請の公開案内) | `common-find` (検索/根拠閲覧、認証後) | `search` / `authorization` | 検証済みの検索範囲は出張申請の代表スライス。企業横断検索全体は未証明 | [#305](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/305) [#343](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/343) |
| S09 | `scenario.workhub.ask-cecil-answer` | Ask CECIL：根拠付き回答 | Agent | — | `common-find` の関連画面のみ | `search` (検索の参考) | 検索/回答UIとの関係はあるが、Agent回答フロー全体の検証済み宣言はしない | [#349](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/349) [#305](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/305) |
| S10 | `scenario.workhub.ask-cecil-action` | Ask CECIL：下書き→人の確認→操作 | Agent / Business | — | 専用一気通貫Scenarioなし | `authorization` (権限の参考) | AIによる権限付き自律実行・本番操作を証明しない | [#349](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/349) [#279](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/279) |
| S11 | `scenario.workhub.app-launcher-authorization` | アプリ一覧と現行権限 | Business / Security | — | Developer Modeの `apps` 画面情報 | `authorization` | アプリカタログ/権限境界の説明。全Providerの実接続は証明しない | [#352](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/352) |
| S12 | `scenario.workhub.communication-separation` | タスク・通知・公式お知らせ・社内交流 | Business | — | 既存HOME/通知/お知らせ/交流の画面情報 | — | 各表示の責務は説明可能。全Scenario統合テストの代替ではない | [#348](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/348) |
| S13 | `scenario.workhub.error-recovery` | 業務画面の失敗と復旧案内 | Business / Security | — | `scenario.workhub.error-recovery` (部分Reference) | `workflow` (申請のVariation) | 404/拒否/競合など一部はローカル受入あり。帳票失敗UI・正式STは未完 | [#350](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/350) |
| S14 | `scenario.operations.failed-job-recovery` | ジョブ失敗→安全な復旧操作 | Operational | — | Admin/Operations実装・認証が必要 | — | 実装と操作証拠は各Issue参照。公開Showcaseに専用ツアーなし | [#416](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/416) [#429](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/429) [#430](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/430) |
| S15 | `scenario.operations.integration-reconcile` | 連携UNKNOWN→照合→安全な再試行 | Operational / Integration | — | Admin Integration画面・認証が必要 | — | UNKNOWNからの無条件再送を保証しない。公開専用ツアーなし | [#304](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/304) [#419](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/419) [#429](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/429) |
| S16 | `scenario.operations.recovery-readiness` | Backup→復旧可能性の判定 | Operational | `/showcase/#showcase-recovery` (公開・模擬) | Admin Recovery画面は別途認証 | `recovery` | 架空の復旧判断デモ。Remote D1復旧/Provider Restore/実運用再開を実行しない | [#431](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/431) [#46](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/46) |
| S17 | `scenario.operations.security-finding-review` | セキュリティFindingの確認と是正 | Operational / Security | — | Admin Security Center・認証が必要 | — | Findingレビューは実装根拠参照。公開ツアーでの検証済み操作とは別 | [#410](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/410) [#420](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/420) |
| S18 | `scenario.operations.overview-drilldown` | 運用概況→各コンソールへ | Operational | — | Admin Operations Overview・認証が必要 | — | OverviewはProjection。UNKNOWN/NOT_MONITOREDを正常と断定しない | [#414](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/414) [#429](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/429) |

## 既存資産へのアクセスとテスト根拠

| 対応する代表例 | 実装／設計 | テスト | 注意 |
|---|---|---|---|
| S01・S02 出張承認 | [TravelRequest service](../../src/reference/workhub/travel-request/service.ts) | [Browser E2E](../../e2e/tests/workhub-travel-request.spec.ts) | 承認・差戻しに関する代表E2E。実企業の組織権限を保証しない |
| S03 出張と精算 | [Expense service](../../src/reference/workhub/expenses.ts) | [Browser E2E](../../e2e/tests/workhub-expenses.spec.ts) | 経理承認 ≠ 実支払い |
| S04・S05 模擬申請 | [SecondaryJourneys](../../src/reference/workhub/WorkhubSecondaryJourneys.tsx) | [Browser E2E](../../e2e/tests/workhub-secondary-journeys.spec.ts) | 実人事・IT資産変更なし |
| S08 検索 | [Travel Search](../../src/reference/workhub/travel-search.ts) | [Browser E2E](../../e2e/tests/workhub-travel-request.spec.ts) | Current Authorizationの出張申請スライスのみ |
| S13 失敗案内 | [エラー受入記録](WORKHUB_ERROR_RECOVERY_ACCEPTANCE.md) | [Developer Guide E2E](../../e2e/tests/workhub-developer-guide.spec.ts) | 一部Referenceのみ・正式ST #694未実施 |
| S14–S18 管理・復旧 | [Admin Portal](../../src/reference/admin/AdminPortal.tsx) / [Integration queue](../../src/reference/admin/IntegrationFailureQueue.tsx) / [Security Center](../../src/reference/admin/SecurityCenter.tsx) / [Overview](../../src/reference/admin/OperationsOverview.tsx) | [Issue #431](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/431) / [Issue #420](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/420) | 各Verticalに固有の実装・CI証拠があり得るが、18件全部のLive/正式STを主張しない |
| S16 模擬復旧 | [RecoveryDecisionLab](../../src/reference/showcase/RecoveryDecisionLab.tsx) | [Recovery test](../../tests/recovery-showcase.test.ts) | 公開読取専用、実Restore不可 |

## 画面での辿り方

1. 公開`/reference`で代表3シナリオのカードと設計・Source・E2Eを確認し、必要なら公開`/showcase`へ移動する
2. この18件の対応表で、実際の公開案内があるものと、認証後Developer ModeのCatalog／模擬／設計だけのものを区別する
3. 認証後WORKHUBのDeveloper Modeでは登録済み**7件のScenario Catalog**と14画面のScreen Catalogを参照できる。これを18件すべてが実装済みという意味にはしない
4. 管理系S14–S18はAdmin/Operationsの個別Vertical・Issueの証拠を確認する。公開Showcaseで確認できるS16は架空復旧判断デモで、他の管理機能の操作を自動実行しない
5. 今後のPreview/Production配信状態、正式ST #694、外部利用者評価 #475は、この対応表では完了扱いしない

## 受入の範囲

元受入 **「WORKHUB demo / scenario mapping」** に対して、既存18件すべてのStable ID・業務目的・公開デモ有無・Developer/Admin対応先・Reference表示の有無・根拠を、**既存成果の再利用**で整理した。元受入条件の文言や順序は変更しない。他の条件（全Capability inventory mapping、Reference Site全体実装、Public release readiness review）は独立であり、これらの完了を意味しない。

元受入 **「Broken link / stale documentation check」** は先行PR #785/#786で現行掲載範囲の検査が証拠上合格と評価されているが、GitHub checkboxの更新はブロックされているため、**Issue #433のチェック欄を正本**として扱う。
