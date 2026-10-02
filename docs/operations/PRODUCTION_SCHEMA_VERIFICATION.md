# Production Schema Verification

Production deploy / migrationの前後で、Applicationが期待するSchemaとProduction D1の実Schemaが一致しているかをfail closedで検証する。

## Responsibility boundary

この機能はmigrationを実行しない。Production D1へPR CIから接続しない。Operator / Production workflowが取得した**非secretのSchema snapshot**を入力として検証する。

- `#107 Production Migration Preflight`: migration開始前の安全条件・Evidence・backfill/invariant contract
- `#109 Production Schema Verification`: migration後 / deploy前の期待Schemaとの一致確認
- `#108 Production Migration Workflow`: 将来、実際のProduction操作をこれらのguardで囲む

## Baseline

`config/production-schema-baseline.json`に、TemplateがApplication contractとして依存するcritical table / column / indexを定義する。

Migration stateはbaselineへ二重管理せず、Repositoryの`migrations/`にある`NNNN_name.sql`をexpected setとしてその都度算出する。

## Snapshot contract

例:

```json
{
  "phase": "post-migration",
  "environment": "production",
  "databaseId": "<production D1 id>",
  "databaseName": "<production D1 name>",
  "previewDatabaseId": "<preview D1 id>",
  "appliedMigrations": ["0001_core.sql", "..."],
  "tables": {
    "users": ["id", "display_name", "created_at", "updated_at", "status"]
  },
  "indexes": ["idx_application_sessions_user"]
}
```

Snapshotへbusiness row、token、secret、PIIを含めない。必要なのはSchema metadataとresource identifierだけである。

## Verification modes

`phase`は`pre-deploy`または`post-migration`。

どちらもApplicationが期待するmigration setとProductionが一致していることを要求する。段階migrationで旧SchemaのままApplicationをdeploy可能とする判断は、このVerifierへ暗黙に持ち込まず、#107の明示的compatibility contractで扱う。

## Stop Conditions

以下はexit code 1で停止する。

- environmentがProductionでない
- Production / Preview resourceが同一
- resource identifierがplaceholder
- expected migrationの不足、余分なmigration、順序不一致、重複
- required table欠落
- required column欠落
- required index欠落

Mismatchをwarningだけで流さない。

## Commands

Self-test:

```bash
npm run db:schema:verify:production -- --self-test
```

Production workflowでsnapshotを検証:

```bash
npm run db:schema:verify:production -- --snapshot=/path/to/schema-snapshot.json
```

## Evidence

Reportには以下のようなmetadataだけを残す。

- phase
- expected / applied migration count
- required table count
- required index count
- mismatch名

Business data内容やsecret値はEvidenceへ出さない。
