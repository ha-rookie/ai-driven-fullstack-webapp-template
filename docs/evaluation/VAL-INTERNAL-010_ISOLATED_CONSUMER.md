# VAL-INTERNAL-010 — Workflow/AuthZを隔離した一時Projectで実行する（#475）

**Evidence Type: INTERNAL / isolated temporary project.** 観測するのは再利用時に選ぶコードの依存範囲と小規模な業務ルールの実行結果であり、別GitHub Repositoryへの導入、独立開発者、AWS/Azureでの運用、外部利用者による採用、AIに新規生成させる場合との公平な工数比較ではない。

## 解決したい問題

前回の[VAL-INTERNAL-009](VAL-INTERNAL-005_PURCHASE_REUSE.md)は `types: []` でCloudflare専用型を持ち込まない静的コンパイルに成功。しかしRepository全体が同じ作業ディレクトリに存在するため、必要なファイルを抜き出した**別のプロジェクトで本当に動作するか**の証拠にはなっていない。

ここでは新しいWorkflow Engineを作らず、使用可能な既存コードだけを持ち出す場合の依存関係を検証する。

## 再現方法

既存の開発環境で（初回のみ `npm ci`）:

```bash
node scripts/reuse-isolated-smoke.mjs
```

スクリプトは次だけを行う。

1. OSのテンポラリ領域に空の作業ディレクトリを作成（Repository外）
2. **既存の6 TypeScript source files（以下の5共通ファイル＋購買Consumer）**と独立実行用runnerのみをコピー
3. 一時Projectの `tsconfig.json` を生成。 `types: []`、Node/Cloudflare ambient型なし、CommonJSの実行用JSを生成
4. Repositoryに既存のTypeScriptコンパイラを**ビルドツールとしてのみ**利用。隔離Projectには `node_modules` を配置しない
5. 出力されたJSファイルが**選択した6ファイルのみ**であることを照合（余分な依存が増えた場合に検知）
6. 隔離Project内部でNodeのテストRunnerを実行し、終了時に一時ファイルを削除

コピー対象:

| 用途 | ソース |
| --- | --- |
| Workflow型 | `src/worker/workflow/types.ts` |
| Workflow遷移 | `src/worker/workflow/service.ts` |
| Workflow一時Store | `src/worker/workflow/in-memory-store.ts` |
| 認可型 | `src/worker/authorization/types.ts` |
| Scope/Role Policy | `src/worker/authorization/policy.ts` |
| 購買業務Adapter | `examples/reuse/purchase-approval.ts` |

実行する業務Acceptanceの主な項目は、部門長→経理の二段階承認、別担当者の拒否、Role不一致、所属Scope不一致、Membership偽装、Version stale、重複Submit、金額不正、承認者未解決のfail-closed。

`node:assert` 等のNode標準機能はテストRunner側のみで使い、持ち出す5共通ソース側にはNode固有の依存を追加しない。外部API、D1、Preview、Production、CloudflareのSecret・Resource・Migrationは使わない。

## ビジネス価値の読み方

**確認できる場合の結論:** 小さな業務承認の遷移とScope/Role判定を、Template/WORKHUB全体に依存せず、既存ソース6ファイルで実行できる。別Cloudでの部分参考・コード選択の入口を示せる。

**確認できない結論:** コピーペーストで商用利用可能、コードが常に安く移植できる、AWS/Azureで動くことを確認済み、AIで書き直すより速い、他Repositoryが実際に採用した、という主張はしない。

残る導入の仕事: SDK/npmパッケージ配布設計、永続Workflow Store、Server側の認証・Membership解決、所属の変更検知、Domain DB更新の整合、Audit/通知/Recovery/運用、UI/API、業務要件に合わせた承認規程や承認者Directory。今回はInMemoryの学習用例でありDurable transactionは検証していない。

## Reuseとゼロから生成の比較基準（次段階）

「AIが生成するのだから既存部品は不要」という仮説を反証可能にするには、**同一仕様・同一Acceptance**で、A=この6ファイルの移植、B=独立AIによる新規実装を別Projectで実施し、(1)追加/修正コードの範囲、(2)テスト失敗と修正回数、(3)権限・重複・Version・業務更新整合の考慮漏れ、(4)保守するソース量、(5)実際の操作/開発時間を比較する必要がある。

今回B方式の実装と独立評価は**未実施**。時間短縮率や価格価値を捏造しない。外部開発者による利用も含め#475で継続追跡する。

## CIコスト

既存の影響ファイルを判定するportable Workflow/AuthZ CIステップでのみ `node scripts/reuse-isolated-smoke.mjs` を実行。ユニットテストを丸ごと再発明せず、既存のUnit Testと小さな隔離環境のAcceptanceで評価を分ける。デプロイ・ブラウザ・Remote D1テストはこの検証のために実行しない。

次の評価: [VAL-INTERNAL-011 — 既存部品Aと限定新規実装Bの同一12件Acceptance比較](VAL-INTERNAL-011_PURCHASE_AB_COMPARISON.md)。この評価は同じChatGPTが既存Aのコードを知ったうえでBを作成した非盲検の内部比較であり、独立AIによる性能評価や工数短縮の証拠には数えません。
