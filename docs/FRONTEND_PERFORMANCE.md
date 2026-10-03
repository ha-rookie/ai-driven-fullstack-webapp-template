# Frontend Performance Foundation

## Purpose

React SPAの性能を、D1/API側の性能とは分離して確認する。

このFoundationは次の2種類のEvidenceを扱う。

1. **Production build static evidence**
   - JavaScript / CSS / total asset bytes
   - largest asset
   - file count
   - Project-defined budgetとの比較
2. **Local production-build browser evidence**
   - navigation timing
   - LCP
   - CLS
   - same-origin request count
   - resource count / transfer size

Localで得た値をProduction RUMやSLAとして扱わない。

## Build evidence

`npm run build` 後に以下を実行する。

```text
npm run performance:frontend:bundle
```

既定では `dist/client` を読み、次を `artifacts/performance/` へ出力する。

- `frontend-build.json`
- `frontend-build.md`

### Optional Project budgets

Templateは固定byte budgetを強制しない。

Project側で必要なら以下を設定する。

```text
FRONTEND_MAX_TOTAL_JS_BYTES
FRONTEND_MAX_SINGLE_JS_BYTES
FRONTEND_MAX_TOTAL_CSS_BYTES
FRONTEND_MAX_TOTAL_ASSET_BYTES
```

値が未設定ならEvidenceのみ生成し、絶対値によるGateは行わない。

## Browser evidence

Browser Workflowでは通常のE2Eの後にProduction bundleをbuildし、`vite preview`上で次を実行する。

```text
npm run performance:frontend:browser
```

Desktop Chromiumとmobile相当viewportを別々に計測する。

Evidence:

- `frontend-browser-desktop-chromium.json`
- `frontend-browser-mobile-chromium.json`

### Metrics

- navigation `domContentLoadedMs`
- navigation `loadEventMs`
- navigation `responseEndMs`
- Largest Contentful Paint（LCP）
- Cumulative Layout Shift（CLS）
- same-origin request count
- resource count
- resource transfer bytes when browser reports them

### INP

Template root pageにはProductを代表する操作がない。

そのためINPを無理に計測値へ変換せず、Baselineでは `not-measured` とする。

Projectで代表操作が定義できた時点で、その操作scenarioに対してINP/RUMを追加する。

## Optional browser budgets

Project NFRが決まった場合のみ次を設定できる。

```text
FRONTEND_MAX_LCP_MS
FRONTEND_MAX_CLS
FRONTEND_MAX_INITIAL_REQUESTS
```

未設定の値は `not-configured` であり、0やsuccessへ変換しない。

## Interpreting evidence

### Local build/browser evidenceで分かること

- bundleが急増していないか
- JavaScript chunkが肥大化していないか
- 初期表示時のrequest amplificationが増えていないか
- Local production buildでLCP / CLSが大きく悪化していないか
- desktop / mobile viewportで差がないか

### 分からないこと

- 実利用者のネットワーク品質
- 実端末CPU性能
- CDN edge / region差
- Production traffic下のCore Web Vitals
- Product固有画面のroute transitionやINP

それらはProject側のRUM / synthetic monitoring / Product scenarioで扱う。

## Regression policy

Template CIでは固定のLCPやbundle byte数をuniversal gateにしない。

理由:

- Productごとに画面量・画像量・許容UXが異なる
- shared CI runnerの時間値は揺れる
- Template root pageは実Productではない

代わりに、Evidenceを保存し、ProjectがNFRを持つ場合だけthresholdを設定する。

## Related

- `PERFORMANCE_CAPACITY.md`: D1 workload / query plan / resource budget
- `BOUNDARY_TESTING.md`: API boundary correctness
- `RUNTIME_EVIDENCE_STATUS.md`: Repository / CI / Preview / Production verification separation
- Issue #60

## Out of scope

- Production RUM SaaSの固定
- universal Core Web Vitals SLA
- backend load/stress/soak testing
- Product固有route budget
- low-end端末の完全なhardware emulation
