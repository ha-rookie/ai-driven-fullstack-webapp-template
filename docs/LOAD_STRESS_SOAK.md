# Load / Stress / Soak Testing Foundation

## Purpose

Web/API全体について、同時アクセス・burst・継続負荷時の劣化を再現可能なEvidenceとして残す。

D1単体の代表Query benchmarkは `PERFORMANCE_CAPACITY.md` が担当する。本FoundationはHTTP boundaryを通したread-only workloadを担当する。

## Safety model

Templateの標準scenarioは**read-only**に限定する。

- `/api/health/database` → expected `200`
- `/api/auth/me` → unauthenticated boundaryとしてexpected `401`
- `mixed` → 上記2つを交互に実行

更新API、Production、実顧客データへの負荷試験はBaselineに含めない。

Mutation concurrency / idempotencyは専用のLocal boundary testを正本とし、高負荷試験の名目で更新を大量実行しない。

## Profiles

`http-load-test.mjs` は安全上限付きの4 profileを持つ。

| Profile | Requests | Concurrency | Delay |
| --- | ---: | ---: | ---: |
| smoke | 40 | 4 | 0 ms |
| load | 400 | 10 | 0 ms |
| stress | 1,200 | 25 | 0 ms |
| soak | 600 | 5 | 500 ms / worker |

これらはTemplateのEvidence workloadであり、業務システムの想定同時利用者数ではない。

Hard safety cap:

- requests <= 5,000
- concurrency <= 50
- delay <= 10,000 ms
- response body <= 1 MiB / request
- request timeout 10 seconds

Projectがより大きい負荷を必要とする場合は、quota/cost/影響範囲を明示したProject固有testとして設計する。

## Local PR smoke

Pull Requestでは `.github/workflows/http-load-evidence.yml` がLocal D1とLocal Workerを起動し、`smoke + mixed` のみを実行する。

目的:

- concurrent HTTP execution engineが動く
- Worker HTTP boundaryが同時アクセスを処理できる
- database readinessとunauthenticated auth boundaryが期待Statusを返す
- p50 / p95 / p99 / error rate / requests per secondを生成できる

これはstress testではない。

## Manual Preview load

Remote Previewへの負荷は自動実行しない。

GitHub Actionsの `HTTP Load Evidence` を `workflow_dispatch` で起動し、次を明示する。

```text
confirmation = LOAD_TEST_PREVIEW
profile = smoke | load | stress | soak
scenario = health | auth-boundary | mixed
```

Repository/Organization Variables:

```text
PREVIEW_BASE_URL
PRODUCTION_BASE_URL
```

Preview実行時のGuard:

- `LOAD_TEST_PREVIEW` の完全一致が必要
- Preview URLはHTTPSのみ
- localhostは禁止
- target originは `PREVIEW_BASE_URL` と完全一致
- `PRODUCTION_BASE_URL` と同一originなら拒否
- Production modeそのものをCLIに提供しない

## Evidence

JSON / Markdownに次を残す。

- mode
- target origin
- profile / scenario
- request count / concurrency / delay
- success / failure count
- error rate
- duration
- requests per second
- latency min / p50 / p95 / p99 / max
- HTTP status count
- scenario count
- response bytes
- threshold assessment

Request body、Cookie、Token、response bodyはEvidenceへ保存しない。

## Optional Project thresholds

Templateは固定SLAを持たない。

Project NFRが決まった場合だけ次を設定する。

```text
LOAD_TEST_MAX_ERROR_RATE
LOAD_TEST_MAX_P95_MS
```

未設定ならEvidenceのみ生成する。

## Load / Stress / Soakの意味

### Load

想定範囲の並列性で、error rateやlatencyが急に悪化しないかを見る。

### Stress

より高い並列性で、どこから劣化が大きくなるかを見る。

Template profileは安全上限内の例であり、限界値そのものではない。

### Soak

短いburstだけでは見えない継続負荷を、低めのconcurrencyとdelayで一定時間近く継続させる。

Templateでは外部resource消費を抑えるためbounded request countを採用する。

## Stop conditions

次の場合は実行しない、または停止する。

- Production URLしか用意されていない
- PreviewとProductionのoriginを区別できない
- quota/costの影響が不明
- testがwrite scenarioを必要とする
- targetが第三者serviceや実顧客環境
- load testに認証secretを直接埋め込む必要がある
- Project NFRをTemplateのuniversal thresholdとして固定しようとしている

## Relationship to other evidence

- `PERFORMANCE_CAPACITY.md` → D1 query / capacity / resource budget
- `FRONTEND_PERFORMANCE.md` → browser / bundle / Core Web Vitals系
- `RUNTIME_EVIDENCE_STATUS.md` → 実装済み / CI / Remote / Productionの区別
- Idempotency concurrency test → duplicate mutation safety
- Issue #61

## Out of scope

- Production load/stress/soak
- destructive workload
- write-heavy synthetic traffic
- distributed load generator
- third-party paid load testing SaaSの固定
- universal concurrency / p95 SLA
- auto-scaling design
