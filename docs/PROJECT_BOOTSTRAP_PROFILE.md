# Project Bootstrap Profile

## Purpose

このProfileは、Generic TemplateのRequirement / Design / Plan / Tasks / Operationを、React + Workers + D1のFull-stack Projectで追加判断が必要な項目へ接続するための**Project開始時の決定表**です。

新しい開発プロセスや第二のRequirement documentを作るものではありません。Generic Templateを正本としたまま、Full-stackで未決定のまま進めると事故になりやすい項目だけを明示します。

## Files

- `config/project-bootstrap-profile.example.json`: Template用の未決定Profile
- `scripts/validate-project-bootstrap-profile.mjs`: 構造と決定状態のvalidator
- `docs/recipes/`: 決定後に実装・検証するFull-stack固有Recipe

ProjectではExampleをコピーし、Project側の管理方針に合わせてProfileを保持してください。

```bash
cp config/project-bootstrap-profile.example.json config/project-bootstrap-profile.json
```

Profileには秘密情報を入れません。具体的なtoken、password、private key、cookie secret、Production credentialはRepository外のSecret管理へ置きます。

## Decision state

各decisionは次の3状態だけを使います。

- `undecided`: 未決定。`value` は必ず `null`
- `decided`: 決定済み。`value` にProject固有の判断を記録
- `not-applicable`: 不要。`value` は `null` とし、`rationale` に不要な理由を記録

`undecided` を暗黙defaultへ置き換えてはいけません。

### Structural validation

```bash
npm run bootstrap:profile:validate
```

Templateに同梱したExample Profileの構造を確認します。

Project側のProfileを確認する場合:

```bash
node scripts/validate-project-bootstrap-profile.mjs \
  --file config/project-bootstrap-profile.json
```

### Project-start gate

実装開始前やProjectのConvergence Gateで「未決定を残さない」運用にする場合:

```bash
node scripts/validate-project-bootstrap-profile.mjs \
  --file config/project-bootstrap-profile.json \
  --require-decided
```

`not-applicable` は理由が書かれていればGateを通過します。

## Mapping

### Requirement

Profileで追加確認する項目:

- `requirement.primaryActors`
- `requirement.resourceScope`
- `requirement.dataSensitivity`

ここでは「誰が使うか」「どの単位のデータを扱うか」「どの程度の機密性があるか」をProject Requirementから参照できる形にします。

### Design

Profileで追加確認する項目:

- `architecture.runtimeBoundary`
- `architecture.domainReplacementPlan`
- `architecture.externalServices`
- `identityAndAccess.*`
- `data.schemaOwnership`
- `api.*`

Templateの `example_resources` / `viewer` / `editor` をProduct vocabularyへそのまま持ち込まず、何へ置き換えるかを明示します。

### Plan

Profileで追加確認する項目:

- `data.migrationSequence`
- `environments.previewResources`
- `environments.productionResources`
- `environments.originSeparation`
- `performance.*`
- `supplyChain.*`

ProfileにはSecret値を入れず、Preview / Production resourceについてはProjectでRepository記録を許可したnon-secret identifierまたは参照名だけを記録します。実Resourceへ接続する操作はHuman Gateを維持します。

### Tasks

Issueへ落とすときはProfileのdecisionをそのまま大きなTaskへ変換しません。

- 1つの責務としてレビュー可能な変更単位へ分解する
- Planned Files / Impact Flags / Validation / EvidenceをIssueへ記録する
- 関連する`docs/recipes/`を選ぶ
- Remote / Production / destructive operationを含む場合はHuman Gateを明示する

密接な責務はbundle PRにしてよいですが、各Issueの完了条件を失わないようにします。

### Operation

Profileで追加確認する項目:

- `data.retentionAndDeletion`
- `data.backupAndRecovery`
- `operations.slo`
- `operations.rpoRto`
- `operations.auditRetention`
- `operations.releaseAndProductionVerification`

TemplateはuniversalなSLA/SLO/RPO/RTOを固定しません。未決定を「Template default」で埋めないでください。

## Suggested adoption flow

1. Generic TemplateのRequirement / Design / Change Contractを確認する
2. Example ProfileをProjectへコピーする
3. Requirementからactor / resource scope / data sensitivityを埋める
4. Auth / Authz / Domain replacementを決める
5. Data / API / Environmentの境界を決める
6. SLO / RPO/RTO / retention / release verificationを決める
7. `--require-decided` で未決定を確認する
8. 必要なRecipeを選びIssueへ分解する
9. Local validationを通す
10. Remote / ProductionはHuman Gateで別途実行する

## Do not

- Product要件をこのProfileだけで完結させない
- `undecided` をTemplate都合のdefaultで決定済みにしない
- Secret値をProfileへ保存しない
- PreviewとProductionのResourceを同一と仮定しない
- Example RoleやDomainをProjectの正式名称として継承しない
- Local / CI evidenceをProduction verifiedと読み替えない

## Relationship to Recipes

Profileは「何を決めるか」、Recipeは「決定した内容をどう安全に実装・検証するか」を扱います。

- DB schema変更 → `recipes/D1_MIGRATION.md`
- Auth Provider追加 → `recipes/AUTH_PROVIDER_ADAPTER.md`
- Resource Scope / Role変更 → `recipes/AUTHORIZATION_BOUNDARY.md`
- 状態遷移 / 排他変更 → `recipes/RUNTIME_INTEGRITY.md`
- Audit event追加 → `recipes/AUDIT_EVENT.md`
- Preview recovery rehearsal → `recipes/PREVIEW_RECOVERY_REHEARSAL.md`
- Performance evidence追加 → `recipes/PERFORMANCE_EVIDENCE.md`
- Production migration / deploy preparation → `recipes/PRODUCTION_PREFLIGHT.md`
