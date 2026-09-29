# Full-stack Template Documentation

このdirectoryは、React + TypeScript + Vite + Cloudflare Workers + D1 に固有の**実装設計**を管理します。

AI駆動開発のGolden Path、Human Gate、Change Contract、Convergence、Tool-neutral PlaybookなどTechnology-independentな開発標準は、Upstreamの `ha-rookie/ai-driven-webapp-template` を正本とします。

## Responsibility boundary

```text
Generic Template
  └─ process / governance / quality criteria
        ↓ reference
Full-stack Template docs
  └─ React / Workers / D1 implementation patterns
        ↓ adapt
Project docs
  └─ requirements / domain / UI / provider / NFR / release
```

このdirectoryへGeneric TemplateのCore Design文書を複製しません。また、Example実装をProject要件として固定しません。

## Baseline layer model

このFull-stack TemplateのBaselineは、存在しない層を形式上追加せず、現在の実装責務に合わせます。

```text
React SPA
   ↓
Worker HTTP Boundary / Composition
   ├─ Authentication / Authorization
   ├─ Validation / HTTP mapping
   ├─ Audit / Correlation
   ├─ Domain rules
   └─ Infrastructure adapters
          ↓
         D1
```

`Application / Use Case` layerはBaseline必須ではありません。複数Repositoryや外部Serviceを跨ぐ業務オーケストレーション、HTTP以外のentrypointからの再利用、route handlerの肥大化など、Project側で明確な必要性が出た場合に追加します。

詳細なDependency Ruleと導入条件は `FULLSTACK_ARCHITECTURE.md` を正本とします。

## Recommended reading order

| Document | Responsibility |
| --- | --- |
| `UPSTREAM_TEMPLATE.md` | Generic Templateとの責務境界、reviewed baseline、重複禁止ルール |
| `FULLSTACK_ARCHITECTURE.md` | Full-stack runtime全体像、baseline layer model、各Foundationの配置 |
| `instructions/README.md` | Full-stack固有Scoped Instructionsの選択方法と責務境界 |
| `DATA_DESIGN.md` | D1 binding、migration、schema、Local / Preview / Production境界 |
| `AUTH_DESIGN.md` | Provider-independent identityとapplication session |
| `AUTHORIZATION_DESIGN.md` | Resource Scope / Membership / Role Policy / Guard |
| `RUNTIME_INTEGRITY.md` | optimistic concurrency、state transition、atomicity、DB constraints |
| `AUDIT_OBSERVABILITY.md` | Correlation ID、structured Audit、安全なfield境界 |
| `BOUNDARY_TESTING.md` | Authn → Authz → Validation → Integrity → Auditの統合境界とnegative paths |
| `RECOVERY_OPERATIONS.md` | Preview recovery rehearsal、Production restore Human Gate、RPO/RTO境界 |
| `PERFORMANCE_CAPACITY.md` | Local / Preview benchmark、query plan、resource budget、計測単位 |

## Scoped Instructions

`docs/instructions/` は、IssueのPlanned Files / Impact Flags /作業意図に応じて必要なFull-stack固有制約だけを追加で読むための層です。

- Design文書の新しい正本を作らない
- Common TemplateのScoped Instructionsをコピーしない
- DB / Auth / Authz / Integrity / Audit / Recovery / Performanceの具体実装境界だけを追加する
- 複数領域に跨る作業だけ必要なInstructionを併用する

選択方法と一覧は `instructions/README.md` を参照してください。

## What belongs here

Full-stack固有で、実際のコード・migration・Worker・D1 operationと対応する内容を置きます。

例:
- D1 session persistence
- Resource ScopeのD1 schema
- optimistic lockingのSQL条件
- Worker request correlation
- protected APIのHTTP mapping
- Preview D1 Time Travel rehearsal
- D1 query-plan benchmark

## What does not belong here

次はGeneric TemplateまたはProject側の責務です。

### Generic Template
- Golden Path
- Human / AI collaboration guardrails
- Issue / Branch / PR運用
- Development / Release Convergence
- Tool-neutral Playbooks
- Technology-independent quality criteria

### Project
- Product requirements
- 実業務のDomain model
- 実際のRole名・権限
- concrete Identity Provider
- UI/UX requirement
- SLA / SLO / RPO / RTO
- Production release condition
- Project固有のSecurity / Privacy / retention requirement

## Example code policy

このTemplateの `example_resources`、`viewer`、`editor`、Example API routeは、Foundation同士を実際に接続して検証するためのExecutable Exampleです。

Projectでは、その意味を理解したうえでProduct固有のDomainへ置き換えてください。名前だけ変更して無条件に継承するものではありません。

## Keeping upstream aligned

GitHub Template Repositoryには自動同期がありません。

Upstream Generic Templateの重要更新を確認したら、`UPSTREAM_TEMPLATE.md` のreviewed baselineを更新し、Full-stack runtime変更が必要かを評価します。

- process / governanceだけの変更 → 原則としてUpstreamを参照し、内容を複製しない
- React / Workers / D1の具体実装へ影響する変更 → Full-stack側で専用Issueを作る
- Project固有の変更 → Project側で扱う
