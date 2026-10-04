# Reference TravelRequest Adapter

## Purpose

WORKHUB Reference Applicationの東京出張Scenarioで、Template CoreのMaster DataとHuman Workflowを、Product固有語をCoreへ漏らさず接続するためのReference Recipeです。

このRecipeはTravelRequestをTemplate Coreへ昇格させません。`TravelRequest`、`TOKYO`、`NAGOYA`、Aoi、RenはReference Application側の語彙です。

## Source of truth

- TravelRequest: Domain Data
- Master Data: Officeの選択可能性と履歴Revision
- Workflow: Approval State / Work Item
- Timeline: user-facing history（#300で追加）
- Notification: now-you-should-know（#302で追加）
- Audit: accountability / investigation

TravelRequestのstatusをWorkflowのApproval Stateの代用にしません。

## Submit flow

```text
Draft
  ↓ Officeをsubmit時刻で再検証しRevisionを固定
Submitting
  ↓ WorkflowService.start()
Submitted
```

1. authenticated principalをrequesterとして扱う。client payloadのrequesterIdを信用しない
2. Draftのversionを確認する
3. `workhub.office`をMaster Dataでsubmit時刻に再解決する
4. disabled / expired / retired Officeならrejectする
5. stable Master Item IDに加えてconcrete Revision IDを保存する
6. `draft → submitting`をcompare-and-setで予約する
7. reservation固有の`submissionKey`でWorkflowを開始する
8. Workflow Instance IDを保存して`submitted`へ確定する

## Failure boundary

TravelRequest StoreとWorkflow Storeは別Source of Truthで、分散transactionは導入していません。

- Workflow開始が明確に失敗した場合: reservationをDraftへrollbackする
- Workflow開始後にTravelRequest最終確定が競合した場合: Draftへ戻さず`submitting`を維持し、`recovery_required`としてfail closedする
- Workflow側でも`submissionKey` uniquenessを二重作成防止の第二境界として使う

プロセス停止がWorkflow作成直後・TravelRequest確定直前に発生した場合の自動recoveryはこのMVPのOut of Scopeです。必要になった時点で#304 Integration Event / Outbox等を検討し、Core APIをReference都合だけで拡張しません。

## Reference fixtures

- Office Master: `workhub.office`
- Offices: `NAGOYA`, `TOKYO`
- Workflow: `workhub.travel_request_approval` v1
- Step: `manager_approval`
- Resolver: `workhub.manager`
- Scenario relationship: Aoi (`workhub-demo-aoi`) → Ren (`workhub-demo-ren`)

Productionへfixtureを自動seedしません。

## Validation

- Draft create / update
- stale Draft update rejection
- requester boundary
- current Office candidates from Master Data
- disabled / expired / retired Office rejection
- concrete Office Revision binding
- Aoi submit → Ren open Work Item
- duplicate submit rejection
- Workflow start failure rollback
- D1 migration / Production schema baseline verification

## Human Gate

このReference実装だけではProduction migration、Production seed、Remote D1 mutationを行いません。それらはHuman Gateです。
