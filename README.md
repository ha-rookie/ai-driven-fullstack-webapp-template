# AI-driven Full-stack Web App Template

React + TypeScript + Vite + Cloudflare Workers + D1 を基盤に、業務Webアプリで事故になりやすい認証・認可・排他・監査・復旧・性能までを実装例として持つFull-stack Templateです。

業務Webアプリの共通基盤を検証・採用する開発者向けです。完成済み業務製品、具体的なログインProvider、実環境の構築・運用保証は含みません。

- [Quick Start / Local development](#local-development)
- [Project Bootstrap Profile](docs/PROJECT_BOOTSTRAP_PROFILE.md)
- [Full-stack Recipes](docs/recipes/README.md)
- [Data Lifecycle / Long-term Backup](docs/DATA_LIFECYCLE_BACKUP.md)
- [Implementation design](docs/README.md)
- [Dependency update policy](docs/DEPENDENCY_UPDATE_POLICY.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy / vulnerability reporting](SECURITY.md)
- [MIT License](LICENSE)

## Positioning

このRepositoryは、AI駆動開発の開発標準そのものを置き換えません。

```text
ha-rookie/ai-driven-webapp-template
  └─ 開発プロセス / Governance / Human Gate / 品質基準
        ↓
ha-rookie/ai-driven-fullstack-webapp-template
  └─ React + TypeScript + Vite + Workers + D1 の実装baseline
        ↓
Project
  └─ Product requirement / Domain / UI / Identity Provider / NFR / Release
```

役割は次のとおりです。

- **Generic Template**: どう開発するか、何を確認するか、いつHuman Gateで止まるか
- **Full-stack Template**: それらの原則をReact / Workers / D1でどう実装するか
- **Project**: 誰の何の課題を解くか、どの業務ルール・画面・Provider・SLOを採用するか

GitHub Template Repositoryは、作成元の後続変更を自動継承しません。Project開始時と重要なTemplate更新時には、Generic Templateの現在地を別途確認してください。確認済みUpstream baselineは `docs/UPSTREAM_TEMPLATE.md` に記録します。

## Implemented baseline

現在のbaselineには次が実装されています。

| Foundation | 主な内容 |
| --- | --- |
| Runtime shell | React SPA / Vite / Cloudflare Worker / Static Assets / health API |
| Shared | `AppError` / `Result<T>` / Validation / Logger |
| Data | D1 binding / numbered migrations / Local-first validation |
| Authentication | Provider-neutral identity / opaque application session / revoke / logout |
| Authorization | Resource Scope / Membership / Project-defined Role Policy / fail closed |
| Runtime Integrity | optimistic concurrency / state transition / atomic multi-write / DB constraints |
| Audit & Correlation | request ID / structured audit / bounded fields / failure isolation |
| Protected Boundary | Authn → Authz → Validation → Integrity → Audit のExample API |
| Observability | health / structured logs / low-cardinality runtime metrics / provider-neutral alert policy |
| Recovery | Preview D1 recovery rehearsal / Production restore Human Gate |
| Data Lifecycle | retention/deletion decision policy / private long-term backup boundary / metadata-only integrity evidence |
| Performance | D1 / frontend / bounded HTTP load evidence |
| Supply-chain | lockfile / vulnerability / secret / SBOM / license checks + Dependabot proposal policy |
| Developer enablement | Project Bootstrap Profile / Full-stack Recipes / undecided decision validation |

`example_resources`、`viewer`、`editor` はTemplateを実行可能にするための中立的な**Example**です。ProductのDomain modelやRole vocabularyとして固定するものではありません。

## Local development

```bash
npm ci
npm run db:migrate:local
npm run db:verify:local
npm run dev
```

## Validation

用途に応じて入口を分けています。

```bash
# TypeScript compile + Node standard test runnerだけを素早く実行
npm run test:unit

# Bootstrap Profile validatorのself-test
npm run bootstrap:profile:validate

# Data Lifecycle policy / backup evidence utilityのself-test
npm run data-lifecycle:validate
npm run data-lifecycle:evidence:validate

# Unit + bootstrap + data lifecycle + Recovery safety + Performance safety + Local D1 performance smoke
npm run validate:local

# 後方互換のFull local validation入口
npm test

npm run lint
npm run build
```

`validate:local` と通常PR CIはRemote D1を使用しません。Data Lifecycle validationも実BackupやPrivate Storageへ接続せず、Policy/Evidence utilityのLocal self-testだけを実行します。

## Dependency maintenance

Dependabotはnpm / GitHub Actionsの更新**提案PRを作る役割**として利用します。Template baselineではdependency auto-mergeを行いません。

更新PRは通常のCI・vulnerability・license・lockfile等の検証を通し、Human reviewでmerge / defer / rejectを判断します。security advisoryは通常のversion update cadenceとは別にtriageします。詳細は `docs/DEPENDENCY_UPDATE_POLICY.md` を参照してください。

## Remote operations

Remote D1を利用する操作は通常CIから分離しています。

- Preview recovery rehearsal: manual `workflow_dispatch`
- Preview performance benchmark / load evidence: manual `workflow_dispatch`
- Preview / Production resource分離を必須化
- placeholder resourceではfail closed
- Production restoreは自動workflow化せずRunbook + Human Gate
- Production load/stress targetは提供しない
- Production long-term backup/exportはProject固有Human Gate。通常PR CIから実行しない

実Previewでの復旧・性能確認やProject固有Backupは、Projectが実Resourceを設定してHumanが明示実行した時点で初めてRemote evidenceとして扱います。

## Project adoption

Project開始時のFull-stack固有判断は `docs/PROJECT_BOOTSTRAP_PROFILE.md` を入口にします。Generic TemplateのRequirement / Design / Change Contractを正本としたまま、認証・権限・データ・環境・性能・運用などの未決定項目を明示します。

```bash
cp config/project-bootstrap-profile.example.json config/project-bootstrap-profile.json

# 構造確認
node scripts/validate-project-bootstrap-profile.mjs \
  --file config/project-bootstrap-profile.json

# Project開始Gateとして未決定も検出する場合
node scripts/validate-project-bootstrap-profile.mjs \
  --file config/project-bootstrap-profile.json \
  --require-decided
```

このTemplateからProjectを始める場合は、少なくとも次をProject側で行います。

1. Generic Templateの最新Governance / Golden Path / Convergence / Playbookを確認する
2. Project固有のRequirement / Architecture / Change Contractを作る
3. Bootstrap Profileをコピーし、`undecided` を暗黙defaultで埋めずにProject判断を記録する
4. `example_resources` とExample RoleをProduct Domainへ置き換える計画を決める
5. concrete Identity Provider、Resource Scope、Role Policyを決める
6. Preview / Production resource、NFR、SLO、RPO/RTO、retention、Release / Production Verificationを決める
7. 長期Backupが必要なら `DATA_LIFECYCLE_BACKUP.md` と `LONG_TERM_BACKUP.md` に沿って保存先・retention・restore rehearsalを決める
8. dependency update cadence、security advisory response、major updateのrelease/rollback方針を決める
9. `--require-decided` で未決定を確認し、必要な `docs/recipes/` を選んでIssueへ分解する

ProfileやLifecycle PolicyにはSecret値を保存しません。Remote / Production / destructive operationはProfileが埋まっていてもHuman Gate対象です。

Generic Templateの文書をこのRepositoryへ丸ごとコピーして、二つのSource of Truthを作らないでください。

## Documentation

Full-stack固有の設計書と推奨読順は `docs/README.md` を参照してください。

Project開始時の追加判断は `docs/PROJECT_BOOTSTRAP_PROFILE.md`、長期Backup/retentionは `docs/DATA_LIFECYCLE_BACKUP.md`、繰り返し作業の安全な実行手順は `docs/recipes/README.md` を参照してください。

Upstreamとの責務境界と確認済みbaselineは `docs/UPSTREAM_TEMPLATE.md` を参照してください。

Dependency更新の提案・検証・Human review境界は `docs/DEPENDENCY_UPDATE_POLICY.md` を参照してください。

## License

This project is licensed under the MIT License. See `LICENSE` for details.
