# Capability inventory → Reference section 対応表（Issue #433 既存Inventory）

## 目的と正本

この表は[Issue #433](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/433)にすでにある「Capability Inventory / Reference Metadata Mapping v0.1」の**初期Top-level候補80件（8領域）**を、同Issueで確定したInformation ArchitectureのReference sectionへ**1件ずつ**紐付けた索引です。新しいCapabilityを追加せず、GitHub Issueのタイトル・優先順位・受入条件・成熟度を変更しません。

- **候補の正本:** Issue #433の「2. Initial top-level Capability Inventory」。**Issue ≠ Capability**という既存原則を維持
- **Sectionの正本:** 同Issue「Information Architecture」。ここに記すSectionは既存IA上の**情報の置き場所**であり、独立した実装ページや新規ルートを作った証拠ではない
- **公開カードの正本:** [ReferenceSite.tsx](../../src/reference/site/ReferenceSite.tsx) の6件の実カードID。`台帳のみ`は現行サイトに個別カードがない意味で、機能が未実装／公開に失敗したという断定ではない
- **状態の正本:** GitHub Issue/PR/CI。元InventoryのAdoption/Maturityは初期設計時点の分類であり、ここで現時点の実装・Preview/Production検証へ勝手に昇格しない
- **検査範囲:** 元Inventoryの80候補に重複/漏れなくIA Sectionを付与し、現行公開カード6件の対応先を明記する。Capabilityごとの全ADR/Scenario/Recipe/Evidence精査やReference Site全ページ実装まではこの表の完了条件に含めない

## 元Inventoryの80候補 → IA Section / 現行公開カード

| ID | 元Inventory Capability | Issue | 元Domain | Reference section（既存IA） | 公開カードID | 位置付け |
|---|---|---|---|---|---|---|
| C01 | Frontend Application Shell | #40 | Experience | Architecture | 台帳のみ | 初期候補 |
| C02 | Browser E2E / Accessibility | #49 | Experience | Components | 台帳のみ | 初期候補 |
| C03 | User Preferences | #288 | Experience | Components | 台帳のみ | 初期候補 |
| C04 | Internationalization / Localization | #289 | Experience | Components | 台帳のみ | 初期候補 |
| C05 | Theme / Appearance | #290 | Experience | Components | 台帳のみ | 初期候補 |
| C06 | Data Table / Saved Views | #291 | Experience | Components | 台帳のみ | 初期候補 |
| C07 | Personalization | #292 | Experience | Components | 台帳のみ | 初期候補 |
| C08 | Notification Preferences | #293 | Experience | Components | 台帳のみ | 初期候補 |
| C09 | Help / Feedback | #294 | Experience | Overview | 台帳のみ | 初期候補 |
| C10 | Keyboard Shortcut / Command Palette | #295 | Experience | Components | 台帳のみ | 初期候補 |
| C11 | Print / Presentation UX | #296 | Experience | Components | 台帳のみ | 初期候補 |
| C12 | Human Workflow / Approval | #297 | Business | Business Patterns | `reference-workflow` | 初期候補 |
| C13 | Master Data | #298 | Business | Business Patterns | 台帳のみ | 初期候補 |
| C14 | Business Activity Timeline | #300 | Business | Business Patterns | 台帳のみ | 初期候補 |
| C15 | Transactional Notification | #302 | Business | Business Patterns | 台帳のみ | 初期候補 |
| C16 | Search | #305 | Business | Business Patterns | `reference-search` | 初期候補 |
| C17 | Report / Document Generation | #306 | Business | Business Patterns | `reference-report` | 初期候補 |
| C18 | Data Import / Export | #262 | Business | Business Patterns | `reference-csv` | 初期候補 |
| C19 | Business Date / Calendar | #310 | Business | Business Patterns | 台帳のみ | 初期候補 |
| C20 | Integration Event / Webhook / Outbox | #304 | Integration / Data / Files | Architecture | 台帳のみ | 初期候補 |
| C21 | File Transfer HTTP Boundary | #261 | Integration / Data / Files | Files / External Storage | 台帳のみ | 初期候補 |
| C22 | Object Storage | #52 | Integration / Data / Files | Files / External Storage | 台帳のみ | 初期候補 |
| C23 | Email Delivery | #258 | Integration / Data / Files | Architecture | 台帳のみ | 初期候補 |
| C24 | External Storage Foundation | #336 | Integration / Data / Files | Files / External Storage | 台帳のみ | 初期候補 |
| C25 | External File Picker / Link UX | #341 | Integration / Data / Files | Files / External Storage | 台帳のみ | 初期候補 |
| C26 | Google Drive Adapter | #338 | Integration / Data / Files | Files / External Storage | 台帳のみ | 初期候補 |
| C27 | Microsoft Graph Storage Adapter | #337 | Integration / Data / Files | Files / External Storage | 台帳のみ | 初期候補 |
| C28 | Box Adapter | #339 | Integration / Data / Files | Files / External Storage | 台帳のみ | 初期候補 |
| C29 | Dropbox Adapter | #340 | Integration / Data / Files | Files / External Storage | 台帳のみ | 初期候補 |
| C30 | Data / D1 Foundation | #7 | Platform / Runtime | Architecture | 台帳のみ | 初期候補 |
| C31 | API Contract | #39 | Platform / Runtime | Architecture | 台帳のみ | 初期候補 |
| C32 | Idempotency | #38 | Platform / Runtime | Architecture | 台帳のみ | 初期候補 |
| C33 | Async Job | #51 | Platform / Runtime | Jobs / Batch / Retry / Rerun | 台帳のみ | 初期候補 |
| C34 | Observability / Alerting | #45 | Platform / Runtime | Observability | 台帳のみ | 初期候補 |
| C35 | Feature Flags | #79 | Platform / Runtime | Architecture | 台帳のみ | 初期候補 |
| C36 | Maintenance / Read-only Mode | #43 | Platform / Runtime | Operations | 台帳のみ | 初期候補 |
| C37 | Data Lifecycle / Backup | #46 | Platform / Runtime | Operations | 台帳のみ | 初期候補 |
| C38 | Production Delivery | #42 | Platform / Runtime | Architecture | 台帳のみ | 初期候補 |
| C39 | Shared Runtime Primitives | #56 | Platform / Runtime | Architecture | 台帳のみ | 初期候補 |
| C40 | Authentication Foundation | #9 | Identity / Access | Authentication / Authorization | 台帳のみ | 初期候補 |
| C41 | Authorization Foundation | #11 | Identity / Access | Authentication / Authorization | `reference-authorization` | 初期候補 |
| C42 | Local Credential Authentication | #37 | Identity / Access | Authentication / Authorization | 台帳のみ | 初期候補 |
| C43 | OIDC / OAuth Adapter | #35 | Identity / Access | Authentication / Authorization | 台帳のみ | 初期候補 |
| C44 | SAML Adapter | #36 | Identity / Access | Authentication / Authorization | 台帳のみ | 初期候補 |
| C45 | Passwordless / MFA | #53 | Identity / Access | Authentication / Authorization | 台帳のみ | 初期候補 |
| C46 | Service Authentication | #54 | Identity / Access | Authentication / Authorization | 台帳のみ | 初期候補 |
| C47 | Step-up Authentication | #101 | Identity / Access | Authentication / Authorization | 台帳のみ | 初期候補 |
| C48 | Credential Attack Hardening | #100 | Identity / Access | Authentication / Authorization | 台帳のみ | 初期候補 |
| C49 | Durable Audit | #44 | Security / Governance | Security | 台帳のみ | 初期候補 |
| C50 | Security Incident Response | #87 | Security / Governance | Security | 台帳のみ | 初期候補 |
| C51 | Data Masking | #74 | Security / Governance | Security | 台帳のみ | 初期候補 |
| C52 | Security by Design / Assume Breach | #407 | Security / Governance | Security | 台帳のみ | Architecture原則 / Tracking候補 |
| C53 | Continuous Security Assurance | #410 | Security / Governance | Security | 台帳のみ | 初期候補 |
| C54 | Encryption & Key Management | #411 | Security / Governance | Security | 台帳のみ | 初期候補 |
| C55 | Sensitive Data Egress Control | #412 | Security / Governance | Security | 台帳のみ | 初期候補 |
| C56 | Break-glass Access | #80 | Security / Governance | Security | 台帳のみ | 初期候補 |
| C57 | Impersonation Context | #81 | Security / Governance | Security | 台帳のみ | 初期候補 |
| C58 | Turnstile Adapter | #149 | Security / Governance | Security | 台帳のみ | 初期候補 |
| C59 | Agent Identity & Authorization | #278 | AI / Agent | AI / Agent / MCP | 台帳のみ | 初期候補 |
| C60 | Human Approval for AI Actions | #279 | AI / Agent | AI / Agent / MCP | 台帳のみ | 初期候補 |
| C61 | AI Audit Context & Trace | #280 | AI / Agent | AI / Agent / MCP | 台帳のみ | 初期候補 |
| C62 | Agent Task Lifecycle | #281 | AI / Agent | AI / Agent / MCP | 台帳のみ | 初期候補 |
| C63 | AI Administration / Emergency Stop | #282 | AI / Agent | AI / Agent / MCP | 台帳のみ | 初期候補 |
| C64 | AI Provider Abstraction | #277 | AI / Agent | AI / Agent / MCP | 台帳のみ | 初期候補 |
| C65 | AI Decision Model | #283 | AI / Agent | AI / Agent / MCP | 台帳のみ | 初期候補 |
| C66 | Agent Rate Limit / Quota | #393 | AI / Agent | AI / Agent / MCP | 台帳のみ | 初期候補 |
| C67 | Usage Metering | #394 | AI / Agent | AI / Agent / MCP | 台帳のみ | 初期候補 |
| C68 | MCP / AI Agent Interface | #273 | AI / Agent | AI / Agent / MCP | 台帳のみ | Future / Tracking候補 |
| C69 | Admin / Operations Portal | #41 | Operations | Admin / Operations Portal | 台帳のみ | 初期候補 |
| C70 | Operations Core & Policy | #429 | Operations | Admin / Operations Portal | 台帳のみ | 共通Operations Core |
| C71 | Administration UI Shell | #99 | Operations | Admin / Operations Portal | 台帳のみ | 初期候補 |
| C72 | Audit Log Viewer | #415 | Operations | Admin / Operations Portal | 台帳のみ | 初期候補 |
| C73 | Job Operations Console | #416 | Operations | Admin / Operations Portal | 台帳のみ | 初期候補 |
| C74 | Safe Data Correction | #417 | Operations | Admin / Operations Portal | 台帳のみ | 初期候補 |
| C75 | Master Data Administration | #418 | Operations | Admin / Operations Portal | 台帳のみ | 初期候補 |
| C76 | Integration Operations | #419 | Operations | Admin / Operations Portal | 台帳のみ | 初期候補 |
| C77 | Security / Self-Audit Center | #420 | Operations | Admin / Operations Portal | 台帳のみ | 初期候補 |
| C78 | Operations Overview | #414 | Operations | Admin / Operations Portal | 台帳のみ | 初期候補 |
| C79 | Backup & Recovery Readiness | #431 | Operations | Operations | `reference-recovery` | 初期候補 |
| C80 | Operations Failure-Safety | #430 | Operations | Operations | 台帳のみ | 横断Control / Evidence |

## 日本固有要件の既存Sub-capability / Recipe family

元Issue #433の「3. Japan-specific capability family」には、#311を1つの巨大Capabilityにせず、業務上意味のある子要素へ振り分ける方針があります。以下6件は**初期80件とは別の子要素／Recipe候補**であり、Top-levelに上乗せして86件の独立Capabilityが公開済みと主張しません。

| 子ID | 元Issueの子要素 | Issue | Reference section（既存IA） | 公開状況 |
|---|---|---|---|---|
| JP01 | Japanese Text Normalization | #313 | Business Patterns | 台帳のみ |
| JP02 | Public Holiday Provider | #314 | Business Patterns | 台帳のみ |
| JP03 | Postal Code / Address | #315 | Business Patterns | 台帳のみ |
| JP04 | Contact / Financial Validation | #316 | Business Patterns | 台帳のみ |
| JP05 | Money / Tax Policy | #317 | Business Patterns | 台帳のみ |
| JP06 | Date / Fiscal Recipe | #318 | Recipes | 台帳のみ |

## 対応付けと未実装の境界

- **掲載中の6カード:** `reference-workflow`（#297）、`reference-authorization`（#11）、`reference-recovery`（#431）、`reference-search`（#305）、`reference-report`（#306）、`reference-csv`（#262）。いずれも既存の[Reference Site](../../src/reference/site/ReferenceSite.tsx)にあり、既存の設計・Source・Testへリンクする。これは**代表例**であり、80件をすべて個別ページ化した意味ではない
- **代表シナリオ:** [WORKHUB_SCENARIO_MAP.md](./WORKHUB_SCENARIO_MAP.md) に既存S01–S18の対応がある。CapabilityのSection分類とScenarioの全関係を機械的に同一視しない
- **独立Capabilityから除くもの:** 元Issueに指定のTracking、実装Stage、WORKHUB固有Design、Adapter/Vertical Slice、Decision/ADR、Research/Watch、Repository Delivery、Noiseを、この80件の新規行として水増ししない
- **Control / Tracking寄りの候補:** #407はArchitecture原則、#429はOperations Core、#430はFailure-Safety横断Control/Evidence、#273はFuture/Trackingも含む。これらを独立した画面や安定稼働の証明としない
- **Public / Preview / Production:** GitHubのCI成功と公開環境の反映は別。Preview/Productionへのデプロイ、Remote D1、Migration、Secrets、Cloudflare資源変更はこの対応表に含まれない
- **元受入の注意:** 「Broken link / stale documentation check」は既存CIによる**証拠上合格**との独立評価があるが、Issue #433のcheckboxが未反映である。表示・集計の正本は実際のcheckboxとし、勝手に完了件数を加算しない

## 検証・更新ルール

既存[Reference browser E2E](../../e2e/tests/reference-site.spec.ts)で、元Inventory80件の件数・ID/Issue重複、8 Domain、既存IA Section名称、現行公開6カードID、日本固有子要素6件の対応を点検する。Inventory本体の正本はIssue #433であり、このMarkdownは**その投影と利用者向け案内**として維持する。
