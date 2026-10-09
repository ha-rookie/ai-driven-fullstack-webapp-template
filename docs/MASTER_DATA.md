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

## #418 Stage 2c: atomic durable audit and zero-row rollback guard

**Important:** D1 `batch()` rolls back on SQL *error*, not when an ordinary conditional statement affects zero rows. Merely checking `result.meta.changes` **after** `batch()` returns cannot undo a previously committed Item version update.

Hardening in this stage:

- Append and scheduled-cutover guarded revision inserts use `CASE WHEN EXISTS(...) THEN environment ELSE NULL END`: a failed mutation marker or previous-period predicate violates the **explicitly NOT NULL environment column** inside the batch, so the entire transaction aborts before commit. SQLite's normal rowid-table `TEXT PRIMARY KEY` is not a reliable NOT NULL guard.
- The controlled Preview `RETIRE_MASTER_ITEM` and `SCHEDULE_MASTER_REVISION` commands create a structured and SHA-256-hashed audit receipt **before** business mutation. The payload contains actor, scope, resource, requestId, action, time and hashed operator reason (not free-text reason).
- `D1MasterDataStore` inserts the prepared receipt into the existing `durable_audit_events` table in **the same batch** as the master mutation. Receipt insert verifies item version, mutation marker and actor. Receipt table missing, hash insert failure, duplicate key or validation error cause an SQL error and roll back all the batch statements.
- The previously supported `D1DurableAuditStore.search` verifies hashes at read-time, so administrators can inspect the same receipts via existing Audit viewer.
- In-memory Store does not pretend to provide this guarantee; tested D1 SQL path is the persistent implementation.
- The generic `addRevision()` foundation has a separate no-audit path but now also aborts when its guarded revision insert fails.
- Tests execute the **real SQLite SQL** using an in-memory Node SQLite D1 adapter, including stale versions, injected failure during period close, and deliberately missing Audit table (assert no Item or Revision change).

Residual bounds: transactionally durable does not mean tamper-proof against a privileged DB writer. A SHA-256 checksum detects corruption during application reads but an attacker who rewrites both record and checksum can bypass it; stronger signed append-only logs / independent export remain a separate security hardening area. No Production mutation is enabled; Production operations remain Human Gate.

Official D1 API: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch

## #418 Stage 3a: Future-enabled / disabled controlled availability

Master's **availability** (`MasterRevision.enabled`) is separate from **retirement** (`MasterItem.retiredAt`). A scheduled disabled Revision suppresses *new selections at and after the cutover*, not historical IDs, previous labels, or business fact snapshots. An enabled future Revision can re-enable an item whose current Revision is disabled.

- Reuse `MasterDataService.scheduleRevision`, so item Version guard, old interval close, new interval insert and durable audit receipt remain in the **same D1 transaction**; do not add an unsafe in-place `enabled` UPDATE.
- Existing bounded `SCHEDULE_MASTER_REVISION` endpoints accept an explicit `enabled` boolean. For existing label-change demos, omitted value continues to mean `true` and disabling remains rejected.
- WORKHUB-specific `availabilityTransitions` restricts `AVAIL_DISABLE` to current `true`→future `false`, and `AVAIL_ENABLE` to current `false`→future `true`; label changes on these items are forbidden. Targets must match explicit server allowlist; TOKYO/NAGOYA are not mutation targets.
- Preview-only admin UI exposes two separate demos, reason/confirmation, Version, future UTC instant, before/after state and Revision history. Existing CSRF, scoped system_admin authorization, Operation Mode, policy gate, idempotency and post-write verification remain.
- Preview fixture uses `INSERT ... ON CONFLICT DO NOTHING`, not resetting, overwriting or deleting prior history. Repeated Preview browser runs inspect already-completed transitions.
- Domain tests assert `listSelectable`, `resolveCurrent`, `resolveAsOf(includeDisabled)` and old Revision ID at the exact half-open cutoff boundary. Browser tests check both operations, persisted Audit evidence, unauthorized target denial and desktop/mobile.
- **Current limitation:** a new future cutover cannot be scheduled on top of an already-scheduled future cutover before its effective date, as `scheduleRevision` only replaces the *currently effective* open-ended Revision. Multi-step chained future plans and cancellation/rescheduling require an independent design/gate.

No Production mutation is enabled. This vertical slice does not imply the entire #418 generic Master Administration UX is complete.

## #418 Stage 3b: future-effective display order without weakening availability policy

Following #517, `SCHEDULE_MASTER_REVISION` already supports strictly allowed future enabled/disabled transitions. Display ordering is now a **third, independent project permission dimension**:

- `orderChangeItemIds` is a dedicated project-supplied allowlist; the only WORKHUB permitted target is the non-referenced `ORDER_DEMO` item.
- For that target, the new Revision must keep the exact current `label` and `enabled` state; it must change the integer `displayOrder` (safe range -1,000,000…+1,000,000). Arbitrary combinations of status/order/label remain forbidden.
- For the existing availability-only target IDs, any provided `displayOrder` is forbidden. For label-only targets, `displayOrder` is also forbidden. Missing value retains existing order, preserving backward compatibility.
- Preview shows `currentDisplayOrder → proposed displayOrder`, requires reason and confirmation; execute maintains scoped system_admin, CSRF, idempotency, operation-mode, atomic durable audit, optimistic Version and read-after-write checks.
- The old effective period keeps its original display order, and the new value takes effect exactly at the future half-open interval boundary. Business Fact snapshots and historical Revision IDs are never mutated.
- Non-destructive Preview fixture uses only the dedicated `ORDER_DEMO` Master. TOKYO/NAGOYA are not allowed.
- This does **not** add an unrestricted UI for arbitrary Master Definitions or a hierarchy editor. Their policy/validation model remains subsequent #418 work.


## Preview authentication 503 acceptance gate (2026-10-09)

Browser acceptance for #418 Stage 3b is **not yet green**. Exact main `35f6946aef65e48e1480a4018238fc4b7248b2da` had two independent runs with 19/24 passing and 5 login-time HTTP 503 failures:
- https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/37824436881
- https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/37848757058

The master order D1 mutation itself was not reached in those failed tests. In the original browser log a 503 login lacked both application `x-request-id` and Preview `x-auth-dependency-stage`, unlike an application-formed authentication 503 which attaches both. This is **consistent with**, but not definitive proof of, an upstream/platform response or incomplete Worker response. Application D1 failure cannot yet be ruled out without request-specific Worker/Cloudflare traces.

The test-only `submitPreviewLogin` helper records safely bounded response metadata (status, requestId, auth stage, CF Ray, Retry-After; no passwords/cookies/bodies) for each attempt. Only a 503 with **neither application requestId nor auth stage** is eligible for up to two bounded UI retries. A 503 carrying application evidence, plus all 401/403/429 statuses, immediately fails the acceptance test. Do not change Production auth, password hashing, user lockouts, or scope protection to accommodate Preview smoke.

Next acceptance: PR CI → pinned Preview deployment → isolated fixture seed → desktop/mobile Browser smoke with **24/24 passes**; independently review any reported unattributed retries as unresolved availability incidents (passing after a retry is not evidence that the underlying platform instability was cured). Further investigation needs Cloudflare Worker request logs/health evidence corresponding to the CF Ray at a failure; these are not available from GitHub Actions logs.

## #521 Preview reliability gate: fail fast on incomplete authentication HTTP bodies

A 200 status from `/api/auth/login` indicates only that HTTP response **headers** arrived. In run 37855404392, response body consumption stalled for 30 seconds even after status 200, until the browser job's 10-minute ceiling canceled the suite. The root cause cannot be attributed to the app, Cloudflare edge or D1 without trustworthy CF-Ray/Worker traces.

The shared Preview browser sign-in helper now waits at most **seven seconds** for the **actual login JSON body** after status 200, validates the authentication payload, then lets the session helper inspect real session cookies and verify actual authorization. Do not use Playwright `Response.finished()` as the gate: run 37869794448 demonstrated it timed out for every login, even when response headers reported 200. Incomplete/failed bodies are classified as test failures with sanitized metadata. No credential/session material or response bodies are logged. `401`, `403`, `429`, application-generated `503` remain fatal, and only unattributed `503` receives the existing bounded two retries.

The new unit tests distinguish complete, transport-broken and never-completing responses. This is a **fail-fast stabilization**, not a root-cause fix or permission to mark #521 complete. Do not lower scrypt parameters, bypass user login, weaken attack guards, or raise the Preview acceptance bar silently. Keep #521 open for Cloudflare edge/Worker and D1 observability correlation.
