# WORKHUB Developer Guide — 画面からテンプレートの構造を調べる

## 目的と適用範囲

WORKHUBは、Cloudflare Workers / D1とReactによる業務アプリ向け**Reference Application**です。Developer Modeは実際の業務画面を開いたまま「何を再利用でき、何を個別に実装するか」を調べるための静的な説明画面です。Debug Console / DB Explorer / Log Viewerではありません。

**動くデモ = 本番導入可能・法令適合・運用品質保証、ではありません。** Sample/Mock、参照実装、再利用可能な設計パターンは別物です。運用環境の権限・性能・障害対応・監査・システムテストが別途必要です。

## 5ステップで画面を追う

1. WORKHUBのLocal/Reference Preview環境で本人としてログインし、「実装情報」を開く
2. 「この画面」でScreen IDとScenarioを確認。画面名ではなくstable IDを入口にする
3. Capabilityを確認し、**Domain / Workflow（正本）** と **Projection / Index（表示用）**、**Adapter（外部連携）** を分ける
4. 「全体ガイド」でArchitecture Mapを上から読み、Capability Mapの画面ボタンで同じ部品を使う他画面へ移る
5. Scenario Catalogで「Reference実装の導線あり」「構想・ガイド例のみ」を見分け、公開GitHubのSource / Docsをたどる

## 構造の捉え方

```text
Human UI / WORKHUB
  ↓
Application + current Authorization
  ↓
Travel Request Domain (申請フィールドの正本) ── Workflow (承認状態/割当の正本)
  ↓                        ↓
MY WORK / Search / Timeline / Notification (それぞれの表示・通知責務)
  ↕
Master / External / Mock Adapter (接続先の契約)
```

例として「出張申請を出す」場合、申請フィールドの正本はTravelRequest Domain、承認作業の割当はWorkflowです。MY WORKや検索結果を、そのまま更新先の正本として扱わないでください。Ask CECILの回答・会話も業務正本ではありません。

## 代表Scenario

| Scenario ID | 状態 | 対象 / 範囲 |
|---|---|---|
| `travel-request-settlement` | Referenceの関連導線あり | 出張申請→本人確認→承認作業→通知。経費精算を含む全自動処理とは断定しない |
| `common-find` | Referenceの関連導線あり | 検索→権限内文書→根拠確認。根拠不足は推測せず人へ |
| `newcomer-onboarding` | Catalog-only | ガイド内では端から端までの動く導線を保証しない |
| `ai-access-request` | Catalog-only | 構想。権限付与や申請の実装済機能ではない |

## コピーして使うときのチェック

- Business Domainの正本は何か、どのAPI/Workflowが最終更新するか
- 最終的なAuthorizationがサーバー側で再判定されるか
- Read Modelや検索Indexが古い場合にどう正本へ戻すか
- 外部AdapterがMockか本番接続か、失敗やRetryの扱いは何か
- UIの表示・手順の整合が保たれるか（日本語/英語、Light/Dark、Mobile）
- Production Secret / D1 / Cloudflare ResourceやMigrationが別途Human Gateか
- リアル端末・OSスクリーンリーダー・認証済みPreviewは統合System Testで確認したか（未実施を合格扱いしない）

## 制約・証拠

Developer Modeは静的に登録した説明情報だけを表示します。実User権限、申請フィールド、トークン、秘密鍵、Raw SQL、ログを取得しません。画面の表示可否はBusiness DataのAuthorizationを変更しません。ProductionではDeveloper Mode入口を既定無効とし、Source/Docsリンクは公開リポジトリの許可済みパスだけを利用します。

Reference機能と実施済み/未実施テストは各Stageの受入記録を優先してください。

- [Stage5 Ask CECIL受入](WORKHUB_STAGE5_ASK_CECIL_ACCEPTANCE.md)
- [WORKHUB Stage6 実装Issue](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/351)
- [Implementation Roadmap](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/132)

このGuideは設計・導入学習用であり、本番稼働判定やサポート窓口の代替ではありません。
