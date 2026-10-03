# Full-stack Recipes

## Purpose

このdirectoryは、Full-stack Templateで繰り返し発生する作業を、特定AI Agentや特定ツールに依存しない**実行Recipe**として整理します。

Generic TemplateのGolden Path / Human Gate / Change Contract / Convergence / Tool-neutral Playbookを置き換えません。各RecipeはReact / Workers / D1固有の入力、Stop Condition、Validation、Evidenceだけを追加します。

## How to use

1. Issue / Change Contractを読む
2. Planned Files / Impact Flagsから必要なScoped Instructionを選ぶ
3. 対応するDesign Sourceを読む
4. このdirectoryから作業Recipeを選ぶ
5. RecipeのStop Conditionを確認してから実装する
6. Validation / EvidenceをIssueまたはPRへ残す
7. Remote / Production / destructive operationではHuman Gateを維持する

Recipeを使うこと自体は承認ではありません。

## Recipe map

| Recipe | Use when | Primary sources |
| --- | --- | --- |
| `D1_MIGRATION.md` | D1 schema / migrationを追加・変更する | `../DATA_DESIGN.md`, `../instructions/database-migration.md` |
| `AUTH_PROVIDER_ADAPTER.md` | concrete Identity Provider adapterをProjectへ追加する | `../AUTH_DESIGN.md`, `../instructions/authentication-session.md` |
| `LOCAL_CREDENTIAL_AUTH.md` | ID / Password認証・Password変更・Resetを追加する | `../AUTH_LOCAL_CREDENTIAL.md`, `../AUTH_DESIGN.md`, `../instructions/authentication-session.md` |
| `AUTHORIZATION_BOUNDARY.md` | Resource Scope / Membership / Role Policyを追加・変更する | `../AUTHORIZATION_DESIGN.md`, `../instructions/authorization-resource-scope.md` |
| `RUNTIME_INTEGRITY.md` | optimistic concurrency / state transition / atomicityを変更する | `../RUNTIME_INTEGRITY.md`, `../instructions/runtime-integrity.md` |
| `AUDIT_EVENT.md` | accountabilityが必要な操作へAudit eventを追加する | `../AUDIT_OBSERVABILITY.md`, `../instructions/audit-correlation.md` |
| `DURABLE_AUDIT_STORAGE.md` | Audit Eventをprivateな永続Storeへ保存し、検索・retentionを設計する | `../DURABLE_AUDIT_STORAGE.md`, `../AUDIT_OBSERVABILITY.md`, `../AUTHORIZATION_DESIGN.md` |
| `PREVIEW_RECOVERY_REHEARSAL.md` | Preview D1 recovery rehearsalを実行する | `../RECOVERY_OPERATIONS.md`, `../instructions/recovery-remote-operation.md` |
| `LONG_TERM_BACKUP.md` | provider recovery windowを超える長期Backup / retention / restore evidenceを設計する | `../DATA_LIFECYCLE_BACKUP.md`, `../RECOVERY_OPERATIONS.md` |
| `OBJECT_STORAGE.md` | 添付PDF・画像等をprivate Object Storageへ分離する | `../OBJECT_STORAGE.md`, `../DATA_LIFECYCLE_BACKUP.md`, `../AUTHORIZATION_DESIGN.md` |
| `FILE_TRANSFER_HTTP.md` | ブラウザから添付ファイルを安全にUpload / Downloadする | `../FILE_TRANSFER_HTTP.md`, `../OBJECT_STORAGE.md`, `../AUTHORIZATION_DESIGN.md` |
| `DATA_IMPORT_EXPORT.md` | CSVで業務データをDry-run / commit / streaming exportする | `../DATA_IMPORT_EXPORT.md`, `../RUNTIME_INTEGRITY.md`, `../AUTHORIZATION_DESIGN.md` |
| `ASYNC_JOB.md` | 時間のかかる処理・Retry・定期処理をHTTPから切り離す | `../ASYNC_JOB.md`, `../RUNTIME_INTEGRITY.md`, `../AUDIT_OBSERVABILITY.md` |
| `EMAIL_DELIVERY.md` | 認証・Invitation・通知等のtransactional emailを送る | `../EMAIL_DELIVERY.md`, `../AUTH_DESIGN.md`, `../AUDIT_OBSERVABILITY.md` |
| `FEATURE_FLAG_ROLLOUT.md` | 新機能をPreviewからProductionへ段階的にON/OFFする | `../FEATURE_FLAGS.md`, `../AUTHORIZATION_DESIGN.md`, `../OPERATION_MODE.md` |
| `PERFORMANCE_EVIDENCE.md` | D1 / Frontend / HTTP load evidenceを追加・更新する | `../PERFORMANCE_CAPACITY.md`, `../FRONTEND_PERFORMANCE.md`, `../LOAD_STRESS_SOAK.md` |
| `PRODUCTION_PREFLIGHT.md` | Production migration / deploy前の確認を整理する | `../operations/PRODUCTION_MIGRATION_PREFLIGHT.md`, `../operations/PRODUCTION_DEPLOY_WORKFLOW.md` |

## Common recipe contract

各Recipeは可能な限り次を明示します。

- Inputs: 作業前に確定している必要がある情報
- Stop Conditions: AI/Automationだけで先へ進めてはいけない条件
- Steps: Full-stack固有の実装順
- Validation: Local / CI / Preview / Productionのどこで何を確認するか
- Evidence: PR / Workflow Artifact / Release Evidence等に残すもの
- Do Not: よくある危険な近道

## Selection rule

複数の境界を跨ぐ場合はRecipeを併用します。

例:

- Auth Provider追加 + user provisioning schema変更 → `AUTH_PROVIDER_ADAPTER` + `D1_MIGRATION`
- Local Credential追加 → `LOCAL_CREDENTIAL_AUTH` + `D1_MIGRATION` + 公開Login endpointではCredential Attack Hardening
- Password Reset通知 → `LOCAL_CREDENTIAL_AUTH` + `EMAIL_DELIVERY`
- Protected mutation追加 → `AUTHORIZATION_BOUNDARY` + `RUNTIME_INTEGRITY` + 必要なら`AUDIT_EVENT`
- 長期保存するAuditを追加 → `AUDIT_EVENT` + `DURABLE_AUDIT_STORAGE`
- Production migrationを含むrelease → `D1_MIGRATION` + `PRODUCTION_PREFLIGHT`
- 長期保全を含むdata変更 → `D1_MIGRATION` + `LONG_TERM_BACKUP`
- 添付ファイル保存を追加 → `OBJECT_STORAGE` + `FILE_TRANSFER_HTTP` + `AUTHORIZATION_BOUNDARY`
- CSV一括登録 → `DATA_IMPORT_EXPORT` + `RUNTIME_INTEGRITY` + 必要なら`AUDIT_EVENT`
- CSV出力で個人情報を扱う → `DATA_IMPORT_EXPORT` + `AUTHORIZATION_BOUNDARY` + Data Masking
- 大量CSVを裏側で処理 → `DATA_IMPORT_EXPORT` + `ASYNC_JOB` + `RUNTIME_INTEGRITY`
- 定期Jobで業務更新 → `ASYNC_JOB` + `RUNTIME_INTEGRITY` + 必要なら`AUDIT_EVENT`
- Invitation / Password Reset通知 → `EMAIL_DELIVERY` + 対応するAuth/Invitation境界
- Retry可能な通知Job → `EMAIL_DELIVERY` + `ASYNC_JOB` + 必要なら`AUDIT_EVENT`
- 新機能を段階公開しつつ権限制御も必要 → `FEATURE_FLAG_ROLLOUT` + `AUTHORIZATION_BOUNDARY`

すべてのRecipeを毎回読む必要はありません。関係する境界を落とさないことを優先します。

## Project-specific decisions

Recipe実行前にProject固有の判断が未決定なら、`../PROJECT_BOOTSTRAP_PROFILE.md` とProject Profileへ戻ります。

特に以下をRecipe側で勝手に決めません。

- concrete Identity Provider
- Local Credential identifier semantics / Password blocklist / Reset notification / public endpoint attack controls
- Product Role名 / permission
- Domain model
- SLA / SLO / RPO / RTO
- retention期間
- backup provider / storage location
- Object Storage provider / bucket / binding / quota / versioning / signed access
- File Transferのsize / count / MIME allowlist / forbidden disclosure / scan policy
- CSV Import / Exportのcolumn schema / max bytes / max rows / commit mode / formula protection / async threshold
- Async Jobのprovider / payload / lease / retry / concurrency / schedule / DLQ / Queue binding
- Email Provider / sender domain / sender / reply-to / binding / quota / retry / duplicate-delivery policy
- durable Audit対象 / search-export access policy / write mode
- Feature Flag key / rollout condition
- Production resource / origin
- dependency update cadence
