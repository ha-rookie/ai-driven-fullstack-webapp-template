# マスタデータFoundation

この文書は、拠点・カテゴリ・費目などの**比較的単純な参照データ**を、最新値だけでなく有効期間と履歴を含めて安全に扱う共通基盤を定義します。

## IdentityとRevisionを分ける

```text
Master Item
  stable internal identity + business code
       ↓
Master Revision
  label / enabled / effective period / display order / parent / attributes
```

Itemの内部IDとcodeは安定した参照先です。名称等の変更可能な値はRevisionへ置きます。

この分離により、名称変更後も過去時点のRevisionを取得できます。

## CurrentとHistoricalを区別する

新規入力候補は現在時刻で `listSelectable()` / `resolveCurrent()` を利用します。

過去Business Factの表示や意思決定根拠では、要件に応じて次のどれかを明示します。

- stable Item ID + `asOf` timestamp
- concrete Revision ID
- Domain側に保存した表示snapshot

**過去Factを常に現在Revisionへ暗黙再解決しません。**

## Effective period

Revisionは半開区間 `[effectiveFrom, effectiveTo)` で扱います。

```text
2026-01-01 <= t < 2027-01-01
```

`effectiveTo = null` はopen-endedです。

同一Itemに期間が重なるRevisionは拒否します。future Revisionは事前登録できますが、有効開始前にcurrent値へはなりません。

## enabled / retired

- `enabled=false`: その期間で新規選択させない
- future: まだ有効期間前
- expired: 過去期間のRevision
- retired: Item自体を通常の新規利用から外す

通常運用で物理deleteを使いません。

retired / disabled / expiredでも、concrete Revision IDや適切な`asOf`による履歴参照は可能です。

## Project定義

`MasterDefinition`はProject側から注入します。

- `key`
- `schemaVersion`
- hierarchyを使うか
- code validation
- attributes validation

Template Coreへ`office`、`expense_type`、`TOKYO`等の具体語彙を固定しません。

`attributes`は無制限なschema-less Storeとして扱いません。Core側でJSON互換・サイズ上限を確認し、Project側の`validateAttributes`で許可項目や型を確認してください。

## Hierarchy

階層を許可したDefinitionだけsingle-parent hierarchyを利用できます。

- self-parentを拒否
- parentは同一Master
- parentは子Revisionの`effectiveFrom`時点で選択可能であること
- cycleを拒否
- 最大深さをboundedにする

複雑な組織履歴やgraphは専用Domainへ分離します。

## Concurrency

Master Itemは`version`を持ちます。

Revision追加は、

1. expected Item version一致
2. Itemがretiredでない
3. 既存Revisionと期間重複しない
4. `last_mutation_id`を更新
5. 同じmutation markerを確認できた場合だけRevision insert

の順でD1へ適用します。

同じItemへ複数Adminが同時編集してもlast-write-winsで履歴を潰さない設計です。

## Source of Truth / 責務境界

```text
Business Entity
   ↓ stable item / revision ref
Master Data
```

Master Dataは次の責務を持ちません。

- Workflow
- Business Entityの状態
- Auditの正本
- Business Timeline
- CSV parser
- Product固有の業務validation

CSV更新が必要なProjectは#262のDry-run / Import基盤と接続します。

## Audit / Event

Item作成・Revision追加・retire成功後に`MasterDataEventSink`へbounded Eventを渡せます。

Event Sink失敗で成立済みMaster mutationをrollbackしません。強いatomicityが必要ならOutbox等をProject側で追加します。

## Read-only / Maintenance

`MasterDataMutationGate`へ既存Operation Mode Guardを接続します。

- read: 許可
- Item作成 / Revision追加 / retire: 拒否

Master専用Operation Modeは作りません。

## D1 schema

`0022_master_data.sql`:

- `master_items`
- `master_revisions`

Production migrationは通常PR CIでは実行しません。Local migration / schema verificationのみ自動検証し、Production適用はHuman Gateです。

## Reference Applicationとの境界

WORKHUBの東京出張Scenarioでは、Project側で例えば次のDefinition/データを作れます。

```text
Office
- NAGOYA
- TOKYO
```

これらはReference Applicationのデータであり、Template Coreへ組み込みません。

## #418 Administration read-only Stage 1

Admin Portalは、まずProjectが許可したMaster Definitionの参照から始めます。

- `GET /api/admin/master-data?scopeId=...&masterKey=...`: 最大50 Itemの一覧
- `itemId` 指定時: 最大50 Revisionの履歴と `current / future / expired / disabled / retired` の時点別状態
- Server-side authentication / `master_data:view` scoped authorization / Project definition allowlist / runtime environment filter
- JSON attributes、credential、任意のtable選択、arbitrary SQLは公開しない
- 件数上限を超える場合は `hasMore` を明示して、全件取得と誤解させない
- Coreの既存#298更新サービスを唯一のマスタ更新経路として維持する（本StageのAPIはGET専用）
- #298 Master ItemにScope列はない。Reference APIは信頼できるProject Scopeに明示的に紐付け、別Scopeへの無条件共有を許さない

次Stageのmutation（future-effective revision追加、retire等）は、CSRF、expectedVersion、reason、Audit、Operations Core、Production Human Gateの設計とAcceptanceを終えるまでUIから開放しません。

## #418 Stage 2a: Preview controlled retirement

`RETIRE_MASTER_ITEM` は物理削除や任意行編集を行わず、#298 `MasterDataService.retireItem(expectedItemVersion)` を呼ぶ明示的なCommand。

- `GET /api/admin/master-operations/retire/preview` / `POST /api/admin/master-operations/retire/execute`
- `master_data:retire` のserver-side scoped authorizationが必要
- WORKHUB Referenceでは、出張申請に使用されない `workhub-office-legacy` のみ明示的に許可
- CSRF / Idempotency-Key / expectedVersion / reason / confirmation / policy versionを確認し、#429 Operations Coreの `CONTROLLED_CHANGE` とAudit/Verificationを通す
- Operation Modeがread-only/maintenance/unavailableのときは拒否
- Productionはendpointでも明示的に拒否し、Human Gate維持。Preview fixtureだけを対象に実行する
- 競合やすでに廃止された状態は409として扱う。成功後は再読込したVersion・retiredAt・actorをVerification
- 履歴Revisionは削除しない。過去の出張申請snapshotを書き換えない
- 追加fixtureは既存のPreview seed後に実行。対象アイテムだけをVersion 2の未廃止状態にリセット

**今後:** 有効期間がopen-endedなRevisionに対して、新しいfuture-effective Revisionをそのままappendするとperiod overlapで拒否される。既存期間終了と次Revisionの追加を同一トランザクションで扱うかはStage 2bで独立設計・検証する。

## #418 Stage 2b: Atomic future-effective cutover

A future revision cannot be naively appended when the current interval has `effectiveTo = null`: period overlap must be rejected. Use `MasterDataService.scheduleRevision` to update one current open-ended Revision and schedule one new open-ended Revision in **one D1 batch transaction**.

- Requires `expectedItemVersion`, `priorRevisionId`, future ISO UTC `effectiveFrom`, new label, enabled flag and operator
- Validates current open-ended Revision, non-retired item, project Definition, hierarchy/attributes, and no retroactive change
- `D1MasterDataStore.scheduleRevision` uses Item Version + mutation ID guard, checks that the previous Revision is open and there are no other overlapping future intervals, closes old period, inserts new period within one `db.batch`
- Half-open boundary: just before cutoff old Revision; at cutoff new Revision; neither old ID nor historical Business Fact snapshot is rewritten
- In-memory tests cover exact boundary, stale concurrent version, invalid prior, rejected retroactive action and retired Master; D1 guard tests assert three guarded SQL statements
- Dedicated WORKHUB `SCHEDULE_DEMO` is independently seeded Preview-only without resetting or deleting previous demo history; TOKYO/NAGOYA are never mutation targets
- Preview-only `SCHEDULE_MASTER_REVISION` has `GET /api/admin/master-operations/schedule/preview` and `POST /api/admin/master-operations/schedule/execute`, scoped system_admin capability, CSRF, Idempotency-Key, reason/confirmation, policy version, Operation Mode, #429 structured audit event, and post-state verification; Production endpoint fails closed
- The project-specific admin UI is deliberately separated from generic Master Core

### Remaining gate

Operations Core emits structured audit events to its configured AuditLogger. Do not claim the Master mutation and durable D1 Audit record are transactionally committed together. Atomic audit/outbox design is a separate requirement before #418 is fully closed.
