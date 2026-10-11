# Development Loop — GitHubを正本にした安全な作業再開とローカル実行状態（#547）

## なぜ必要か

会話やAIの実行が中断すると、直前のIssue/PR/CIが何を示していたかを再確認するのに時間がかかる。ここで必要なのは別のAgent Orchestratorではなく、**GitHubで確認できる現況を毎回取り直し、次の行動を安全に一つに絞ること**。

関連: [#547](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/547)、[#529](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/529)、[リスクベースCI方針](RISK_BASED_CI.md)。

## 既存資産を使う

- `scripts/ci-change-impact.mjs` と `.github/workflows/ci.yml`: 変更種別→必要テストとFull fallback（改変不要）
- `scripts/runtime-evidence-status.mjs`: リリース/CapabilityのSHA紐付き証跡確認（目的が異なるため置き換えない）
- GitHub Issue/PR/Actions: 実装・進捗・テスト結果の唯一の正本
- `scripts/preview-change-plan.mjs`: Preview差分の読み取り専用助言（新コマンドから遠隔操作しない）

基本機能 `scripts/dev-loop-resume.mjs` はこれらを迂回せず、**単一Issue/PRの安全な再開判断だけ**を提供する。続く `scripts/dev-loop-state.mjs` は同じGitHub取得処理を再利用し、1 Issueごとのチェックポイントとローカル競合防止を提供する。Node 22標準APIのみ、新ライブラリ・外部ランナー・定期実行・自動Mergeは追加しない。

## 使い方

```bash
# 常にGitHubを問い合わせる（public repositoryならTokenなしでも利用可能な場合がある）
node scripts/dev-loop-resume.mjs \
  --repo ha-rookie/ai-driven-fullstack-webapp-template --issue 547 --pr 581

# IssueにまだPRが紐づいていない場合
node scripts/dev-loop-resume.mjs \
  --repo ha-rookie/ai-driven-fullstack-webapp-template --issue 547

# スナップショットはGitHubではなく、あくまで再開時の差分検知に使う
mkdir -p artifacts
node scripts/dev-loop-resume.mjs --repo ha-rookie/ai-driven-fullstack-webapp-template \
  --issue 547 --pr 581 --output artifacts/dev-loop-547.json
node scripts/dev-loop-resume.mjs --repo ha-rookie/ai-driven-fullstack-webapp-template \
  --issue 547 --pr 581 --previous artifacts/dev-loop-547.json
```

`--output` は既存ファイルを上書きしない（`wx`、private権限）。`artifacts/` はGit ignore対象。スナップショットを添付/共有する前にRepository/Issue情報を確認する。Tokenは `GITHUB_TOKEN` または `GH_TOKEN` から読込可能だが、ファイル/標準出力には書き込まない。Issue本文・PR本文・コメント・認証ヘッダーも出力に保存しない。

**開始/再開は人間あるいは次回セッションがコマンドを実行したときのみ**。今回の仕組みは常駐せず、GitHub上に状態を自動保存しない。会話が切れても勝手に実装を継続するような機能ではない。

## 出力契約（schemaVersion 1）

- `runId`: `owner/repo#issue:pr-or-unassigned`
- `repository`、`issueNumber`、`issueState`、`prNumber`、`branch`
- `baseSha`、`headSha`、`previousHeadChanged`、`merged`
- `checks.validate / checks.secrets`: **PR head SHAが完全一致するWorkflowの最新実行**。`success / failed / pending / unverified`、run IDとattempt
- `currentStep`、`nextAction`、`stopReason`、`humanGate`、`advisoryOnly:true`

**例:**

```json
{
  "currentStep": "waiting_for_ci",
  "nextAction": "recheck_required_checks_on_same_head",
  "stopReason": null,
  "advisoryOnly": true
}
```

出力は必ず**最新GitHub GET結果から再計算**し、`--previous` の内容は「HEADが以前と変わったか」以外に使わない。トークン不足、ネットワーク障害、権限不備などで取得できなければエラー終了し、推測で`ready_for_merge_review`にはしない。

### Next actionの意味

| 条件 | Next action | 安全境界 |
| --- | --- | --- |
| Issue Open、PRなし | `inspect_issue_and_locate_existing_pr_before_branch` | Issue/PRを先に探索し重複作成を防ぐ。依存・許可範囲も確認 |
| PR Draft | `finish_bounded_implementation_and_open_review` | 実装残あり |
| HEADに対しCI未確認 | `verify_exact_head_sha_required_checks` | マージ候補にしない |
| CI running | `recheck_required_checks_on_same_head` | 無期限再試行しない |
| CI Failure | `inspect_failed_check_and_repair_within_budget` | 同じ失敗3回・進展なしなら停止 |
| 両Workflow Success + PR mergeable | `review_diff_policy_human_gates_then_merge` | **CIだけでのMerge許可ではない** |
| PR Merged / Issue Open | `update_linked_issue_roadmap_and_notion` | GitHub進捗・Notion同期の確認 |
| PR Merged / Issue Closed | `none` | 全Acceptanceを実証した意味ではない |
| PR/Issueの不整合、mergeable不明 | `inspect_... ` | Fail-closed、実行を促進しない |

`ready_for_merge_review` は**Review開始の合図にすぎない**。Branch protectionの実地確認、Change Impact、Issue Done条件、人間承認が必要なリモート変更、セキュリティレビューは必ず別途判断する。

### Human Gate（自動化禁止）

- Cloudflare PreviewアプリDeploy / Production、Remote D1 write / migration / seed
- Secrets、Cloudflare resource、Productionデータ、破壊的操作
- 権限外のGitHub設定変更、branch protectionの迂回
- workflow_dispatch、failed CIの無限rerun、Issueの勝手な一括処理

このコマンドが実行するのはGET APIのみ。誤って上記を呼べる書き込み権限やSDKは持たせない。

## テスト、コスト、残課題

```bash
node scripts/dev-loop-resume.mjs --self-test
```

CIでもNodeだけでSelf Testを実行。Issue/PR番号の取り違い・別branch/remote・旧HEADのGreen CI・進行中・Failure・merged未同期・mergeability不明・別Issueに紐付いたPRを含む15ケースを検証。加えて、下記ローカルチェックポイントの失敗・競合ケースもoffline自己テストする。テストはGitHubを呼ばず、npm installやD1/Browserを要求しない。

直近の[#529](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/529)での既存CI baselineは、FULL job中央値約247秒、ローカルテスト中央値約195秒（標本30 run、26件FULL成功）。この数字は**新コマンドの速度改善実績ではない**。以後 #547 で実際の人間の再指示回数と再開時の調査回数をbefore/after比較する。

**引き続き未実装の #547 Completion Gate:** 別端末をまたぐGitHub上での排他/永続Runner管理、複数セッションにまたがる自動継続、bounded repair実行、時間/費用予算の自動制御、実Issueの完全な自動実装→Merge→Notion同期、独立ランナーへの引継ぎ。これらは今回のCLIができると見なさず、#547はOPENとする。


## Phase 1 第2段階：Issue単位ローカルチェックポイント（PR更新）

`scripts/dev-loop-state.mjs` は **Issue 1件の状態をGit管理外の `artifacts/dev-loop/` に記録**する小さな補助CLI。前節の `dev-loop-resume.mjs` と違いローカルファイルのみ書き込む。GitHubやCloudflareへの変更、CI再実行、GitHub Issue/PRの自動作成、merge、Notionの自動書込みは行わない。

```bash
# 初回：IssueとPRを関連付けて記録（最新GitHubから再計算）
node scripts/dev-loop-state.mjs \
  --repo ha-rookie/ai-driven-fullstack-webapp-template \
  --issue 547 --pr <現在のPR番号>

# 同じローカル作業領域の次回・別セッション：Issueだけで前回PR番号を参照
node scripts/dev-loop-state.mjs \
  --repo ha-rookie/ai-driven-fullstack-webapp-template --issue 547

# 同じCI失敗の調査修正を実際に開始する場合だけ人間が明示的に数える
node scripts/dev-loop-state.mjs \
  --repo ha-rookie/ai-driven-fullstack-webapp-template --issue 547 --record-repair

# テストだけを実行する（GitHub / Network / npm / D1不要）
node scripts/dev-loop-state.mjs --self-test
```

別の保存先が必要なら `--state-dir <ローカル保存ディレクトリ>` を**毎回同じ値**で指定する。異なる保存先で起動すると**別のロック領域**となる。複数端末・コンテナ/CI Runnerをまたぐ排他制御ではない。別セッションへの引継ぎが必要なら、GitHub上のIssue/PRとこのローカルJSONを必要に応じて安全に移す。移さない場合もGitHubから現状を取り直せるが、過去のローカル試行回数は引き継がれない。

### 実際に保証すること

- **保存:** `<owner>--<repo>--issue-<番号>.json` に1件ごとの `runId`、Issue/PR番号、最新GitHub HEAD/BASE SHA、判定・次Action・Stop理由・CI/Secret evidence、チェックポイント回数、手動申告修正回数、取得日時を記録。Token、生のIssue/PR本文、顧客データ・Secretは保存しない
- **最新照合:** 前回JSONのPR番号だけを次回照会先のヒントとして復元。`dev-loop-resume.mjs` の同じlive GitHub GETを実行し、HEAD/CI/Issue Stateを**必ず再照会**。ネットワーク取得失敗時は既存チェックポイントを残し、古い情報を成功扱いしない
- **同一Issueの競合防止:** 一時的な `.lock` ディレクトリを原子的に作成し、同じ `--state-dir` 内での二重起動を明示的エラーにする。PR番号が違ってもIssue番号が同じなら同じlock。PR切替は保存済み状態との不整合として停止し、元のJSONを保全
- **中途破損防止:** 排他中に一時JSONを新規作成・flushした後、同じディレクトリ内でrename。既存状態が壊れている場合は上書きせず停止。既存Lockが残っていても勝手に削除/乗っ取りしない
- **修正回数の上限:** `--record-repair` は現在のGitHub CIが**失敗と判定できる時だけ**手動の修正開始回数を +1 する。3回目までは記録でき、それ以降の失敗では `blocked_repair_budget` となり追加修正を促さず手動診断を要求。これは試行回数の自己申告であり**実際の修正を自動実行/保証しない**。成功やmerge後でも履歴数は保持し、勝手に回数をリセットしない
- **開始・実行:** GitHubが `ready_for_merge_review` となっても「コードレビューを開始できる」という助言のみ。Human Gate/Branch Protection/Review/Release policyを通さずMerge実行できるわけではない

### 手動復旧・未解決範囲

同一ローカル端末で異常停止し `.lock` が残った場合は、**同じIssueで動作中のプロセスがないことを確認してから**人が手動で解除する。CLIは既存Lockを自動解放・奪取しない。状態ファイルが破損した場合もエラーで停止し、ファイルを勝手に初期化しない。安全な移動・バックアップや手動調査が必要。

この段階でできるのは **ローカル同時起動の予防と、再起動後の状態復元・最新GitHub照合**。分散ロック、非同期自律実行、Issue→PR→Mergeの自動化、完了条件の自動認定、時間削減の実測ではない。GitHub正本を利用する限り、次のチャットでも最新状況を確認できるが、ローカルJSONを共有しなければローカル試行回数は共有されない。
