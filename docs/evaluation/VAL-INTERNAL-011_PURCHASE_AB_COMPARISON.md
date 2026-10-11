# VAL-INTERNAL-011 — 既存Workflow再利用（A）と小さな新規実装（B）の同一Acceptance比較（#475）

**Evidence区分: INTERNAL / AI-assisted but NOT blind / in-memory limited.**

## ビジネス上の問い

AIで容易に実装できる時代に、既存共通Foundationを採用した方が本当に効果的なのか。既存コードが存在する事実だけでは再利用効果は証明できない。Aを無条件に良いとせず、**小規模な業務に限れば新規実装が簡潔な可能性**も認める。

## 比較対象

- **A — 既存Template再利用:** `src/worker/workflow` 内のtypes/service/in-memory-store、`src/worker/authorization` 内のtypes/policy、および既存 `examples/reuse/purchase-approval.ts`。合計6 TypeScript source files。WORKHUB出張申請のコピーなし。Workflow Engineの汎用的な状態遷移等、今回評価しない機能も含まれる。
- **B — 限定的な新規実装:** `examples/reuse/comparison-greenfield-purchase.ts`。購買申請の2段階承認という限定仕様に合わせてこのChatGPT会話内で作成した独立1ファイル。**AのFoundationはimportしないが、Bの作成者は既にAの仕様・コードを見ている。独立モデル/盲検ではない。**
- **共通の試験:** `examples/reuse/comparison-purchase-acceptance.cjs` の同一12件をAとBで実行。以下の挙動を固定する。

| 検証領域 | Acceptance |
| --- | --- |
| 正常系 | 部門長→経理の承認でCompleted・未処理WorkItem 0 |
| 実行権限 | Wrong Assignee拒否、割当済みでもRole不適合拒否 |
| 所属・本人 | 他Scope拒否、Membership ID偽装/欠損拒否、Requester mismatch拒否 |
| 業務規則 | 金額0・負数・小数・非Safe Integerの拒否 |
| 競合/重複 | 古い承認Version拒否、二重Submit拒否 |
| 解決失敗 | 初期承認者なしで作成ゼロ、次の承認者不明で現Stepを維持 |
| リソース境界 | 別の購買申請IDを指定した承認操作を拒否 |

## 実行方法

```bash
npm ci
node scripts/reuse-isolated-smoke.mjs
```

既存の隔離試験スクリプトを拡張し、AとBを**別々のテンポラリProject**へコピーして、各自に閉じたTypeScript compile（`types: []`、Cloudflare/Node ambient型なし）を実行。生成JSはAが6ファイル・Bが1ファイルであることを強制する。実行時はどちらもテンポラリProjectに`node_modules`を配置しない。2 Projectに同じ12件のテストを走らせ、各結果を標準出力 `PURCHASE_COMPARISON_RESULT` として保存する。

実装・計測の証拠はCIログ内の `PURCHASE_COMPARISON_SCOPE`。計測値は**参照したソースファイル数・空行以外のソース行数**のみ。行数にはTypeScriptの型・汎用拡張機能が含まれ、開発時間・保守性・総コストの直接比較には使えない。

## 判定基準

- 12項目を双方が満たした場合、「この**固定された狭い業務仕様**では2方式がAcceptanceを満たす」とのみ判定。
- 片方が失敗した場合、その実行結果、ケース名、修正内容を記録。理由があってもテスト未合格のまま同等と呼ばない。
- Aの強みの候補は、業務増加時に既にあるWorkflow境界・状態遷移・監査導線等を拡張しやすいこと。ただし本試験の12件では、その差の実利を直接評価しない。
- Bの強みの候補は、単純な申請のために大きなFoundationを取り込まなくても構成できること。小さい＝安全、将来の保守コストが低い、とは断定しない。
- 「どちらが何分速いか」「AIが最初から考慮できたか」を、手順を計時していないこの実験から計算しない。

## 比較のバイアス／不足

1. Bは同一セッションでAの実装と境界条件を知ったうえで作成。**独立AI比較やblind reviewは未実施。**
2. 見えている最終状態の行数は、モデル推論時間、デバッグの反復、人間が仕様を整理した時間を反映しない。
3. Aは汎用Workflow Serviceで、Bは今回の購買業務専用。成果物の機能範囲は一致しない。
4. InMemory-only。D1や他DB、業務データとWorkflowのトランザクション一貫性、Crash/Recovery、通知、認証・所属変更、監査、運用、Productionは対象外。
5. 同じ12受入はサンプルの一部の振舞いを確認するだけで、欠陥不存在を証明しない。
6. 外部開発者・企業の実際の採用/不採用、PoC、商用転用のEvidenceではない。

## 次の意思決定

ここで追加のWorkflow Engineや「A/B用の便利な共通部品」を製品Coreに作らない。次に本当に価値を測る場合は、**既存Foundationの重要な業務上の差分**（戻し・再申請、承認履歴・監査、異常停止と復旧、Durable Storeなど）を同じ契約で加え、独立したAI開発環境か第三者がA/Bを別作業で実装する。作業/修正回数・CI失敗数・要件漏れ・実際の時間を記録する。こうした追加比較は、#475の証拠が増える見込みがある場合だけ行い、内部検証を重ねること自体を目的としない。

Cloudflare Preview/Productionのデプロイ、Remote D1更新、migration/seed、Secrets、外部Resource変更は本比較では実施しない。
