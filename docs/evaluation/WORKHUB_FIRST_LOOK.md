# WORKHUB 初見評価ガイド（#475）

このページは、**初見の開発者が自力で見つけられるか／再利用する判断材料になるか**を検証するための短い手順です。設計者が「何が優れているか」を説明する台本ではありません。

## まず渡すURLは1つだけ

**https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev/showcase**

- 公開Showcaseはログイン不要。説明ツアーの操作では業務データを更新しません
- WORKHUBへのログイン・申請・承認は実際のPreviewセッションや架空データを更新することがあります。評価者の許可なく業務操作をしない
- PreviewはReferenceであり、商用パッケージやProduction-readyの証明ではありません
- 評価者の実名・勤務先・認証Cookie・パスワード・社外秘・個人データは採取・保存しない
- Screen recording / screenshot / interviewは本人の明示的な合意がない限り行わない

## 0. 初見の30秒（説明をしない）

初見で以下をメモします。正答を提示してから質問してはいけません。

1. 何をするProjectだと思ったか
2. 誰が利用するものだと思ったか
3. 最初にどこを押そうとしたか
4. 「触れるアプリ」「説明」「ソース」の違いが分かったか

**観測**：実際に押した場所・言葉・迷った秒数。
**解釈**：何が誤解の原因かという仮説。別欄に書き、混ぜない。

## 1. 3分：公開Showcaseから自力で探す

課題だけを伝え、ボタン名や該当メニューは先に教えません。

> 「社員が申請し、上長が判断する一連の流れを確認してください。その流れがどう実装されているか、1つ根拠を見つけてください。」

観測すること：①ガイドに到達するか、②最後まで進めるか、③実装/テストへのリンクに到達するか、④説明用の図を実画面だと思い込まないか。

「3分で見る」は**シナリオの案内**であり、自動で申請を作る実行ツアーではありません。業務を操作する場合のみ [WORKHUB Login](https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev/) を開きます。

## 2. 5〜10分：なぜこれを再利用するか

課題A：

> 「この申請が二重送信されたり、処理途中で一部だけ失敗したらどう扱うか、判断根拠を1つ探してください。」

課題B：

> 「アクセス権が途中で変わった場合、表示だけで防ぐ仕組みなのか、どこで再判定するのか探してください。」

**先に誘導しない**こと。ヒントが必要になった場合は「ヒントを与えた」回数を記録します。

答え合わせの入口（課題終了後に開く）：

| 追跡するもの | 文書 | 実装または検証 |
| --- | --- | --- |
| 申請 → 承認 → 再申請 | [Travel Request Recipe](../recipes/REFERENCE_TRAVEL_REQUEST.md) | [Service Source](../../src/reference/workhub/travel-request/service.ts) / [Browser E2E](../../e2e/tests/workhub-travel-request.spec.ts) |
| Role / Resource Scope / deny-by-default | [Authorization Boundary Recipe](../recipes/AUTHORIZATION_BOUNDARY.md) | [Authorization Design](../AUTHORIZATION_DESIGN.md) / [Boundary Testing](../BOUNDARY_TESTING.md) |
| 差戻し・排他・履歴 | [Human Workflow Approval](../HUMAN_WORKFLOW_APPROVAL.md) | [Travel Request Source](../../src/reference/workhub/travel-request/service.ts) |
| 検索結果の認可 | [Travel Search Source](../../src/reference/workhub/travel-search.ts) | [Authorization Boundary Recipe](../recipes/AUTHORIZATION_BOUNDARY.md) |

この一覧は「リンクが存在する」ことを示すに留まり、**すべてのSourceが同じ機能のEnd-to-End保証を提供するとは主張しません**。

## 3. 5分：自分の案件へどう持ち帰るか

> 「このRepositoryを全部コピーしなくても構いません。業務アプリを1つ作るなら、ここから何を持ち帰りますか。何も持ち帰らない場合は、その理由は何ですか？」

任意の回答例を先に読み上げません。事後に分類します。

- 実装コード／Recipe／テスト観点／設計方針／Human Gate／教材として利用／何も使わない
- 作り直した方が早いもの／重すぎる仕組み／不足機能／Cloudflare依存による制約

**採用可能性の説明と実際の採用は別**。将来の利用意思は機能採用の実績に数えません。

## 4. 開発者評価に使える無変更の入口

- [GitHub Repository README](../../README.md)：GitHub上で初見の概要を確認
- [Recipes index](../recipes/README.md)：必要な部分だけ採用できるか
- [Human Workflow](../HUMAN_WORKFLOW_APPROVAL.md)：状態遷移と役割
- [Boundary Testing](../BOUNDARY_TESTING.md)：失敗・未認可時の検証
- [Preview Showcase](https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev/showcase)：実画面と区別したガイド

## 5. 記録用ミニテンプレート

下記の形式で1評価=1Record（例: `VAL-INTERNAL-002`, `VAL-HUMAN-001`）。
**再現可能な観測と感想を混同しない**こと。

```yaml
id: VAL-...
evidence_type: INTERNAL | AI-REVIEW | HUMAN | DOGFOOD | PUBLIC | REAL-PROJECT
date: YYYY-MM-DD
entry_url:
context: first-look | guided | real-use
consent_to_record: none | explicit
observation:
  first_click:
  reached_tour: true | false | not_observed
  reached_source_or_test: true | false | not_observed
  help_count:
  friction:
direct_quote: null
interpretation:
hypothesis_confirmed: unknown | partial | yes | no
reuse_artifact: null
would_not_adopt_reason: null
decision:
  priority: P0 | P1 | P2 | P3 | none
  issue_link: null
```

### 証拠のラベル

- `INTERNAL`：設計を知っている作者/AIが行う内部チェック。**Blind評価ではない**
- `AI-REVIEW`：独立したモデル/環境が事前の設計意図を知らずにレビューした結果。環境/モデル/入力を記録する
- `HUMAN`：外部の人間が自力で操作した評価。人間の発言を捏造しない
- `DOGFOOD`：実際の再利用で生じた具体的な摩擦
- `PUBLIC`：公開後に確認できた外部Issue/具体的反応など
- `REAL-PROJECT`：実案件または研修での利用実績

評価者がいなければ外部評価0件と記録します。**本ドキュメントの作成やCI成功だけで `HUMAN` / Adoption は増えません。**

## 6. 判断と還流

- **P0**：誤った安全性の主張・危険な操作誘導・情報露出
- **P1**：入口からデモ/Source/Testへ到達できない、ユーザー切替に行き詰まる
- **P2**：再利用したいArtifactがどれか分からない、失敗時の説明不足
- **P3**：好みに依存する見た目の改善

所見は [#475 Validation](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/475) に **Observation → Interpretation → Decision → Evidence** の順に記載し、実装修正は #267 WORKHUB / #402 Showcase / #433 Reference などの該当Issueへ還流します。

独立した評価がまだ得られない段階では、READMEの導線・リンク存在・ローカル/Previewのブラウザ検証だけを実施します。これは第三者による採用確認の代替にはなりません。
