# 申請・承認Workflow Foundation

この文書は、Product固有の「出張」「経費」「購買」へ依存せず、**申請・承認・差戻し・再申請・否認・取下げ**を扱うserver-side共通基盤を定義します。

## 何を正本にするか

```text
Business Entity
    ↓ resourceType / resourceId
Workflow Instance
    ↓
Work Item
    ↓
Transition
```

- **Business Entity**: 実際の業務データ。Template Coreでは所有しない
- **Workflow Instance**: 承認プロセスの現在状態
- **Work Item**: 今、人が処理すべきTask
- **Transition**: submit / approve / return / resubmit / reject / withdraw の履歴
- **Workflow Definition**: Project側のcode/config。submit時にversionを固定

Frontendのbutton表示やroute状態はSource of Truthではありません。

## Baseline

Baselineはsequential approvalだけを扱います。

```text
submit
  ↓
Step 1 / Work Item
  ↓ approve
Step 2 / Work Item
  ↓ approve
completed
```

各Stepで同時にopenなWork Itemは1件です。

### 差戻し

`return` はterminalではありません。

```text
active
  ↓ return
awaiting_resubmission
  ↓ resubmit
active + 新しいWork Item sequence
```

過去Work Itemをopenへ戻さず、新しいsequenceを作ります。

### 否認

`reject` はBaselineではterminalです。

### 取下げ

`withdraw` はrequesterだけが実行でき、active / awaiting_resubmissionのどこで許可するかはDefinitionで明示します。

## Project側へ残す責務

Template Coreへ次を固定しません。

- 実業務名
- 「上長」「経理」等のRole名
- 組織図
- assignee決定ロジック
- transitionごとの業務文言
- Business Entityの状態更新

`WorkflowAssigneeResolver` が1 Stepにつき1 effective assigneeを解決します。解決できない場合はAdmin・requester・固定Userへfallbackせずfail closedします。

## Concurrency

Workflow InstanceとWork Itemはversionを持ちます。

同じWork Itemに対して、例えば別画面から同時に `approve` と `return` が送られても、期待versionが一致した操作だけが成功します。

D1 Storeでは `last_mutation_id` を使い、最初のoptimistic updateが成功したmutationだけが後続のWork Item更新・次Task生成・Transition追加へ進めます。

HTTP requestの二重送信replayは既存Idempotency Foundationと併用します。Workflow versionはIdempotencyの代替ではありません。

## Reason / Comment

`approve / return / reject` の理由要否はStep Definitionで `required / optional / forbidden` を選べます。

自由文へSecretや不要な機微情報を保存しない運用はProject側で決めます。

## Audit / Timeline / Notificationとの境界

- **Workflow Transition**: 業務状態遷移の正本
- **Audit**: accountability / investigation向け
- **Business Timeline**: 利用者向けの分かりやすい履歴
- **Notification**: Work Itemが発生したことを知らせる情報

これらを1テーブルへ統合しません。

`WorkflowService` は成功したTransitionを返し、任意のEvent Sinkへ通知できます。Event Sink失敗で既に成立した承認をrollbackしません。Durable Outbox等が必要なProjectは別Foundationへ接続します。

Email送信をWorkflow transaction内の必須処理にしません。

## Read-only / Maintenance

`WorkflowMutationGate`へ既存Operation Mode Guardを接続できます。read-only / maintenance中はmutation開始前に拒否してください。

Workflow独自の運用モードを作りません。

## D1 schema

`0021_human_workflow.sql` で次を追加します。

- `workflow_instances`
- `workflow_work_items`
- `workflow_transitions`

Production migrationは通常PR CIから実行しません。PRではLocal migration / schema verificationだけを行い、Production適用はHuman Gateです。

## Baseline外

- parallel approval
- any-one / quorum approval
- arbitrary branching / BPMN
- approval後のDomain cancellation
- Delegation Store本体
- Business Timeline UI
- Notification delivery
- Domain固有Business Entity
