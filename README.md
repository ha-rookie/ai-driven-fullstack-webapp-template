# AI-driven Full-stack Web App Template

React + TypeScript + Vite + Cloudflare Workers + D1 を基盤に、業務Webアプリで事故になりやすい認証・認可・排他・監査・復旧・性能までを実装例として持つFull-stack Templateです。

業務Webアプリの共通基盤を検証・採用する開発者向けです。完成済み業務製品、具体的なログインProvider、実環境の構築・運用保証は含みません。


### まず触る（環境構築不要 / WORKHUB Reference）

**[公開WORKHUB Showcaseを見る（約3分・ログイン不要）](https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev/showcase)**

このRepositoryが**どんな業務判断を再利用できる形にしているか**を、出張申請・承認・差戻しのガイドから確認できます。Showcaseは説明用の画面です。業務を実際に操作する場合のみ、[WORKHUBデモのログイン画面](https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev/)へ進んでください。

初めて評価する方は、順序を決めずに最初に開いて感じたことを確かめるため、[初見評価ガイド（短時間・ソースまで）](docs/evaluation/WORKHUB_FIRST_LOOK.md)を使えます。評価結果はまだ第三者による採用実証ではありません。

- **触る**：Showcase（公開説明）→ WORKHUB（Aoi社員 → 右上「ユーザー切替」 → Ren上長）。デモの操作はPreview上の架空データを更新する場合があります
- **読む**：[出張申請Recipe](docs/recipes/REFERENCE_TRAVEL_REQUEST.md) → [実装Source](src/reference/workhub/travel-request/service.ts) → [Browser E2E](e2e/tests/workhub-travel-request.spec.ts)
- **安全境界を確かめる**：[認可Recipe](docs/recipes/AUTHORIZATION_BOUNDARY.md) → [保護されたHTTPのテスト方針](docs/BOUNDARY_TESTING.md)

> **評価環境の範囲**：Previewは架空データによる技術評価用です。Productionの動作保証や完成した業務製品を意味しません。Showcaseは読むだけで業務データを変更しません。WORKHUBへの実ログイン・申請操作ではPreviewのセッション・デモ業務データが変わることがあります。実データや秘密情報は入力しないでください。


- [WORKHUB Showcase / 3分ガイド](#workhub-showcase--evaluation-journey)
- [Quick Start / Local development](#local-development)
- [Project Bootstrap Profile](docs/PROJECT_BOOTSTRAP_PROFILE.md)
- [Full-stack Recipes](docs/recipes/README.md)
- [Feature Flag Foundation](docs/FEATURE_FLAGS.md)
- [Data Masking](docs/DATA_MASKING.md)
- [Private Object Storage](docs/OBJECT_STORAGE.md)
- [Durable Audit Storage](docs/DURABLE_AUDIT_STORAGE.md)
- [Data Lifecycle / Long-term Backup](docs/DATA_LIFECYCLE_BACKUP.md)
- [Implementation design](docs/README.md)
- [Dependency update policy](docs/DEPENDENCY_UPDATE_POLICY.md)
- [Risk-based CI / regression-test policy](docs/operations/RISK_BASED_CI.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy / vulnerability reporting](SECURITY.md)
- [MIT License](LICENSE)

## WORKHUB Showcase / Evaluation Journey

**まずは動く業務の流れから確認したい方へ：** [公開PreviewのShowcase](https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev/showcase)なら環境構築不要で確認できます。ローカルの場合は起動後に `/showcase`（例: `http://localhost:5173/showcase`）を開いてください。Showcaseはログイン不要です。

- **30秒:** このTemplateは何のためのものか / 本番パッケージとの違いを把握
- **3分:** Aoiの出張申請 → Renの差戻し → 再申請・承認 → 通知・履歴 → 権限付き検索を手順で見る
- **30分:** Tour各Stepから実装・Browser E2E・設計資料をGitHub上で確認

`/showcase`は静的な説明と操作可能なツアーです。**業務を実際に操作する際は `/` のWORKHUBデモログインへ進んでください。** デモデータは架空であり、Remote/Productionの動作・外部SaaSの受領照合・完成したAI Agent機能は保証しません。Preview公開デプロイは別途Human Gate対象です。

評価体験の設計は [#402 Showcase](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/402) と [#474 Evaluation Journey](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/474)、実装上の追跡は [#267 WORKHUB](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/267) に紐づけます。

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
| Data Masking | API responseのsensitive fieldをreveal / mask / omit / email・phone pure masker / fail closed |
| Object Storage | private binary storage contract / Local in-memory adapter / Cloudflare R2 Reference Adapter / generated object ID / environment separation |
| Runtime Integrity | optimistic concurrency / state transition / atomic multi-write / DB constraints |
| Audit & Correlation | request ID / structured audit / bounded fields / failure isolation |
| Durable Audit | D1 append-only-style storage / environment separation / bounded search / retention purge / SHA-256 integrity check |
| Protected Boundary | Authn → Authz → Validation → Integrity → Audit のExample API |
| Feature rollout | environment別boolean Feature Flag / Preview→Production段階公開 / server-side判定 |
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

`validate:local` と通常PR CIはRemote D1やRemote Object Storageを使用しません。Object Storageの共通契約は `InMemoryObjectStorage` で検証し、R2 Adapterは型・unit testで検証します。Data Lifecycle validationも実BackupやPrivate Storageへ接続せず、Policy/Evidence utilityのLocal self-testだけを実行します。

## Dependency maintenance

Dependabotはnpm / GitHub Actionsの更新**提案PRを作る役割**として利用します。Template baselineではdependency auto-mergeを行いません。

更新PRは通常のCI・vulnerability・license・lockfile等の検証を通し、Human reviewでmerge / defer / rejectを判断します。security advisoryは通常のversion update cadenceとは別にtriageします。詳細は `docs/DEPENDENCY_UPDATE_POLICY.md` を参照してください。

## Remote operations

Remote D1 / Object Storageを利用する操作は通常CIから分離しています。

- Preview recovery rehearsal: manual `workflow_dispatch`
- Preview performance benchmark / load evidence: manual `workflow_dispatch`
- Preview / Production resource分離を必須化
- placeholder resourceではfail closed
- Production restoreは自動workflow化せずRunbook + Human Gate
- Production load/stress targetは提供しない
- Production long-term backup/exportはProject固有Human Gate。通常PR CIから実行しない
- Production Audit export / purge / retention変更もProject固有Human Gate。通常PR CIから実行しない
- Production Feature Flag変更も通常PR mergeとは分離し、Project側Human Gateで扱う
- Production Object Storage bucket作成・binding・lifecycle rule・bulk delete・Public access変更はProject側Human Gate

実Previewでの復旧・性能確認やProject固有Backup/Audit/Object Storage運用は、Projectが実Resourceを設定してHumanが明示実行した時点で初めてRemote evidenceとして扱います。

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
6. 個人情報・機微情報として扱うFieldと、誰に `reveal / mask / omit` するかを `DATA_MASKING.md` に沿って決める
7. 添付ファイル等を扱う場合は `OBJECT_STORAGE.md` に沿ってbucket / binding / retention / versioning / quota / malware scan / temporary accessを決める
8. Preview / Production resource、NFR、SLO、RPO/RTO、retention、Release / Production Verificationを決める
9. 監査記録を長期保存する場合は `DURABLE_AUDIT_STORAGE.md` に沿って保存対象・retention・検索権限・export条件・失敗モードを決める
10. 段階公開が必要なら `FEATURE_FLAGS.md` と `FEATURE_FLAG_ROLLOUT.md` に沿ってFlag key・default・Preview/Production rollout条件を決める
11. 長期Backupが必要なら `DATA_LIFECYCLE_BACKUP.md` と `LONG_TERM_BACKUP.md` に沿って保存先・retention・restore rehearsalを決める
12. dependency update cadence、security advisory response、major updateのrelease/rollback方針を決める
13. `--require-decided` で未決定を確認し、必要な `docs/recipes/` を選んでIssueへ分解する

ProfileやLifecycle PolicyにはSecret値を保存しません。Remote / Production / destructive operationはProfileが埋まっていてもHuman Gate対象です。

Generic Templateの文書をこのRepositoryへ丸ごとコピーして、二つのSource of Truthを作らないでください。

## Documentation

Full-stack固有の設計書と推奨読順は `docs/README.md` を参照してください。

Project開始時の追加判断は `docs/PROJECT_BOOTSTRAP_PROFILE.md`、個人情報などの表示制御は `docs/DATA_MASKING.md`、private Object Storageは `docs/OBJECT_STORAGE.md`、監査記録の永続化は `docs/DURABLE_AUDIT_STORAGE.md`、段階公開は `docs/FEATURE_FLAGS.md`、長期Backup/retentionは `docs/DATA_LIFECYCLE_BACKUP.md`、繰り返し作業の安全な実行手順は `docs/recipes/README.md` を参照してください。

Upstreamとの責務境界と確認済みbaselineは `docs/UPSTREAM_TEMPLATE.md` を参照してください。

Dependency更新の提案・検証・Human review境界は `docs/DEPENDENCY_UPDATE_POLICY.md` を参照してください。

## License

This project is licensed under the MIT License. See `LICENSE` for details.