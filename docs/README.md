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
| `PROJECT_BOOTSTRAP_PROFILE.md` | Generic Requirement/Design/PlanをFull-stack固有のProject決定へ接続する開始時Profile |
| `instructions/README.md` | Full-stack固有Scoped Instructionsの選択方法と責務境界 |
| `recipes/README.md` | DB/Auth/Recovery/Performance/Production等の繰り返し作業を安全に実行するRecipe索引 |
| `RUNTIME_PRIMITIVES.md` | Clock / IdGenerator / Runtime Config / Environmentの最小共通境界 |
| `FEATURE_FLAGS.md` | environment別boolean Feature Flag、段階公開、server-side判定、Authorizationとの責務分離 |
| `RUNTIME_EVIDENCE_STATUS.md` | Repository / CI / Preview / Production evidenceを分離したread-only Capability Status |
| `OPERATION_MODE.md` | environment別の運用状態Store、version付き更新、取得不能時のfail-safe契約 |
| `FRONTEND_SHELL_SAFETY.md` | Operation Mode表示、Permission Guard、Error BoundaryのFrontend安全境界 |
| `DATA_DESIGN.md` | D1 binding、migration、schema、Local / Preview / Production境界 |
| `DATA_LIFECYCLE_BACKUP.md` | 長期Backup、retention/deletion、private storage、Backup Evidence、restore rehearsal境界 |
| `AUTH_DESIGN.md` | Provider-independent identityとapplication session |
| `AUTHORIZATION_DESIGN.md` | Resource Scope / Membership / Role Policy / Guard |
| `DATA_MASKING.md` | 個人情報などの表示値をAPI responseでreveal / mask / omitするField Policyとfail-closed境界 |
| `RUNTIME_INTEGRITY.md` | optimistic concurrency、state transition、atomicity、DB constraints |
| `AUDIT_OBSERVABILITY.md` | Correlation ID、structured Audit、安全なfield境界 |
| `DURABLE_AUDIT_STORAGE.md` | 監査記録のD1永続化、検索、retention、整合性検知、失敗モードとProduction境界 |
| `APPLICATION_LOGGING.md` | Application LogのJSON契約、request scope、安全なcontextとAuditとの差分 |
| `OBSERVABILITY_METRICS_ALERTS.md` | low-cardinality runtime metrics、correlation分離、provider-neutral Alert Policy |
| `ORIGIN_CORS.md` | same-origin / cross-origin / preflight / environment-specific allowlist境界 |
| `CSRF_PROTECTION.md` | Cookie Sessionのsession-bound CSRF proof、token取得、Mutation Guard境界 |
| `RATE_LIMITING.md` | fixed-window Rate Limit Guard、shared Store contract、429 / Retry-After / Audit境界 |
| `BOUNDARY_TESTING.md` | Origin/CORS → Authn → CSRF → Authz → Validation → Integrity → Auditの統合境界とnegative paths |
| `SECURITY_HEADERS.md` | Worker API / Static AssetsのSecurity Headers baselineとCSP/HSTS境界 |
| `DEPENDENCY_UPDATE_POLICY.md` | Dependabot提案、CI/Supply-chain検証、Human review、defer/ignore記録の境界 |
| `RECOVERY_OPERATIONS.md` | Preview recovery rehearsal、Production restore Human Gate、RPO/RTO境界 |
| `operations/RELEASE_EVIDENCE_BUNDLE.md` | Release単位のread-only Workflow / Artifact証跡生成、SHAと検証状態の関連付け |
| `security/SECURITY_INCIDENT_RESPONSE.md` | Security incident triage、Session revoke / Mode containment、private evidence、復旧判断とLocal/tabletop rehearsal |
| `PERFORMANCE_CAPACITY.md` | Local / Preview D1 benchmark、query plan、resource budget、計測単位 |
| `FRONTEND_PERFORMANCE.md` | Production build size、Local browser LCP/CLS/request count、Project-defined frontend budget |
| `LOAD_STRESS_SOAK.md` | Local concurrent HTTP smoke、Human-triggered Preview load/stress/soak、安全上限とEvidence |

## Project bootstrap and Recipes

`PROJECT_BOOTSTRAP_PROFILE.md` は、新しいProjectでFull-stack固有に決め直す項目を一覧化します。これはProject RequirementやArchitectureの代替ではなく、**未決定を見える状態にする補助Profile**です。

- Example Profileはすべて明示的な `undecided` から始める
- `decided / undecided / not-applicable` を区別する
- `not-applicable` は理由を残す
- `--require-decided` を使えばProject開始Gateとして未決定を検出できる
- Secret値はProfileへ保存しない

`recipes/` は決定後のFull-stack固有作業を再利用する層です。RecipeはDesign SourceやScoped Instructionを複製せず、Inputs / Stop Conditions / Steps / Validation / Evidence / Do Notを短くつなぎます。

```text
Generic Requirement / Design / Change Contract
        ↓
Project Bootstrap Profile
        ↓
Issue + Scoped Instructions + Design Sources
        ↓
Full-stack Recipe
        ↓
Implementation / Validation / Evidence
```

RecipeはHuman Gateを解除しません。Remote / Production / destructive operationはRecipeに手順が書かれていても別途Human判断が必要です。

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
- shared Clock / IdGenerator / Runtime Config / Environment boundary
- environment-scoped boolean Feature Flag provider / rollout boundary
- Project開始時のFull-stack固有decision profile / validator
- Full-stack固有の繰り返し作業Recipe
- data lifecycle / retention / long-term backup policy and metadata-only evidence
- structured Audit / D1 durable Audit storage / bounded search / retention purge
- API responseのsensitive field reveal / mask / omit policyとpure masking utility
- request-scoped structured Application Log
- low-cardinality runtime metrics / provider-neutral alert evaluation
- dependency update proposal / validation / Human review boundary
- D1 session persistence
- Resource ScopeのD1 schema
- optimistic lockingのSQL条件
- Worker request correlation
- protected APIのHTTP mapping
- Origin / CORS allowlistとpreflight boundary
- Cookie Session mutationのCSRF proof boundary
- reusable Rate Limit Guardとshared Store boundary
- Worker / Static AssetsのSecurity Headers
- Preview D1 Time Travel rehearsal
- D1 query-plan benchmark
- frontend build / browser performance evidence
- bounded Local / Preview HTTP load evidence

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
- 個人情報・機微情報として扱うField一覧と、reveal / mask / omitを決めるRole・permission・利用目的
- concrete backup provider / retention period / deletion schedule
- Project固有Audit retention / export / stronger tamper-resistance requirement
- Project固有Feature Flag key / rollout condition
- Project固有のdependency update cadence / support matrix / release window

## Example code policy

このTemplateの `example_resources`、`viewer`、`editor`、Example API routeは、Foundation同士を実際に接続して検証するためのExecutable Exampleです。

Projectでは、その意味を理解したうえでProduct固有のDomainへ置き換えてください。名前だけ変更して無条件に継承するものではありません。

## Keeping upstream aligned

GitHub Template Repositoryには自動同期がありません。

Upstream Generic Templateの重要更新を確認したら、`UPSTREAM_TEMPLATE.md` のreviewed baselineを更新し、Full-stack runtime変更が必要かを評価します。

- process / governanceだけの変更 → 原則としてUpstreamを参照し、内容を複製しない
- React / Workers / D1の具体実装へ影響する変更 → Full-stack側で専用Issueを作る
- Project固有の変更 → Project側で扱う
