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
| `AUTHORIZATION_BOUNDARY.md` | Resource Scope / Membership / Role Policyを追加・変更する | `../AUTHORIZATION_DESIGN.md`, `../instructions/authorization-resource-scope.md` |
| `RUNTIME_INTEGRITY.md` | optimistic concurrency / state transition / atomicityを変更する | `../RUNTIME_INTEGRITY.md`, `../instructions/runtime-integrity.md` |
| `AUDIT_EVENT.md` | accountabilityが必要な操作へAudit eventを追加する | `../AUDIT_OBSERVABILITY.md`, `../instructions/audit-correlation.md` |
| `PREVIEW_RECOVERY_REHEARSAL.md` | Preview D1 recovery rehearsalを実行する | `../RECOVERY_OPERATIONS.md`, `../instructions/recovery-remote-operation.md` |
| `PERFORMANCE_EVIDENCE.md` | D1 / Frontend / HTTP load evidenceを追加・更新する | `../PERFORMANCE_CAPACITY.md`, `../FRONTEND_PERFORMANCE.md`, `../LOAD_STRESS_SOAK.md` |
| `PRODUCTION_PREFLIGHT.md` | Production migration / deploy前の確認を整理する | `../PRODUCTION_DELIVERY.md`, `../operations/RELEASE_EVIDENCE_BUNDLE.md` |

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
- Protected mutation追加 → `AUTHORIZATION_BOUNDARY` + `RUNTIME_INTEGRITY` + 必要なら`AUDIT_EVENT`
- Production migrationを含むrelease → `D1_MIGRATION` + `PRODUCTION_PREFLIGHT`

すべてのRecipeを毎回読む必要はありません。関係する境界を落とさないことを優先します。

## Project-specific decisions

Recipe実行前にProject固有の判断が未決定なら、`../PROJECT_BOOTSTRAP_PROFILE.md` とProject Profileへ戻ります。

特に以下をRecipe側で勝手に決めません。

- concrete Identity Provider
- Product Role名 / permission
- Domain model
- SLA / SLO / RPO / RTO
- retention期間
- Production resource / origin
- dependency update cadence
