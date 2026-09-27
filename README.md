# AI-driven Full-stack Web App Template

React + TypeScript + Vite + Cloudflare Workers + D1 を基盤に、業務Webアプリで事故になりやすい認証・認可・排他・監査・復旧・性能までを実装例として持つFull-stack Templateです。

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
| Recovery | Preview D1 recovery rehearsal / Production restore Human Gate |
| Performance | Local query-plan smoke / quota-aware manual Preview benchmark |

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

# Unit + Recovery safety + Performance safety + Local D1 performance smoke
npm run validate:local

# 後方互換のFull local validation入口
npm test

npm run lint
npm run build
```

`validate:local` と通常PR CIはRemote D1を使用しません。

## Remote operations

Remote D1を利用する操作は通常CIから分離しています。

- Preview recovery rehearsal: manual `workflow_dispatch`
- Preview performance benchmark: manual `workflow_dispatch`
- Preview / Production resource分離を必須化
- placeholder resourceではfail closed
- Production restoreは自動workflow化せずRunbook + Human Gate
- Production benchmark targetは提供しない

実Previewでの復旧・性能確認は、Projectが実Resourceを設定してHumanが明示実行した時点で初めてRemote evidenceとして扱います。

## Project adoption

このTemplateからProjectを始める場合は、少なくとも次をProject側で決め直します。

1. Generic Templateの最新Governance / Golden Path / Convergence / Playbookを確認する
2. Project固有のRequirement / Architecture / Change Contractを作る
3. D1のPreview / Production placeholderを実Resourceへ置き換える
4. Google / LINE / GitHub等の具体的なIdentity Providerを選ぶ
5. `example_resources` とExample RoleをProduct Domainへ置き換える
6. Project固有のNFR、SLO、RPO/RTO、Release / Production Verificationを決める
7. Repository protectionや公開条件をProjectとして確認する

Generic Templateの文書をこのRepositoryへ丸ごとコピーして、二つのSource of Truthを作らないでください。

## Documentation

Full-stack固有の設計書と推奨読順は `docs/README.md` を参照してください。

Upstreamとの責務境界と確認済みbaselineは `docs/UPSTREAM_TEMPLATE.md` を参照してください。

## License

This project is licensed under the MIT License. See `LICENSE` for details.
