# AI-driven Full-stack Web App Template

React + TypeScript + Vite + Cloudflare Workers を基盤に、認証・認可・DB・排他・監査・境界テストを段階的に追加するためのFull-stack実装テンプレートです。

## Positioning

このRepositoryは、`ha-rookie/ai-driven-webapp-template` が定義するAI駆動開発のGolden Path / Governanceを置き換えません。

- Upstream Template: 開発プロセス・判断基準・品質観点
- This Template: Full-stack Web Appの具体的な実装基盤

Upstream baselineは `docs/UPSTREAM_TEMPLATE.md` で管理します。

## Bootstrap scope

Issue #1では、以下だけを成立させます。

- React SPA
- Cloudflare Worker
- Static Assets / SPA fallback
- `GET /api/health`
- TypeScript strict build
- ESLint
- GitHub Actions CI

D1、Authentication、Authorization、Concurrency、Auditは後続Issueで追加します。

## Local development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run lint
npm run build
```

Production deployはBootstrapの対象外です。
