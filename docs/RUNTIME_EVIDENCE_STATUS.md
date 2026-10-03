# Runtime Evidence Status

この文書は、Full-stack Templateの各Foundationについて、**Repositoryへ実装されていること**と**実際に検証されたこと**を混同しないためのread-only Evidence Viewを定義します。

このViewはSource of Truthではありません。

```json
{
  "authoritative": false
}
```

GitHubのRepository、commit SHA、Workflow run、Release Evidence等の直接Evidenceを正とし、このStatusはいつでも再生成できる派生情報として扱います。

## 1. 目的

Templateの基盤が増えると、単に「完成」と書くだけでは次の状態を区別できません。

- code / docs / workflowはRepositoryに存在する
- Local / PR CIで検証された
- Browser E2Eが実行された
- Previewの実Resourceで確認された
- Productionで対象SHAが実際に検証された

`runtime-evidence-status.mjs` はこれらを別々のEvidenceとして表示します。

## 2. Statusの原則

### authoritative: false

Status JSONそのものを手編集の正本にしません。

EvidenceとStatusが矛盾した場合はEvidenceを優先し、Statusを再生成します。

### 未確認を成功へ変換しない

RepositoryにWorkflowが存在していても、そのWorkflowが実行済みとは扱いません。

同様に、PR CIが成功していてもProductionが確認済みとは扱いません。

### exact SHAを基本にする

Workflow evidenceは対象SHAと結び付けて評価します。

GitHubの通常merge commitについて、merge commitのtreeと第2parent（merged PR head）のtreeが完全に一致する場合だけ、そのPR head SHAを`evidenceSha`として利用できます。

単に「たぶん同じ変更だから」という推測では別SHAのEvidenceを流用しません。

## 3. 主な出力

```text
summary.baselineImplementation
summary.exactShaCi
summary.browserE2E
summary.previewRemote
summary.production
```

### baselineImplementation

Repositoryに必要なFoundationのfile / directoryが揃っているかを確認します。

値:

- `implemented`
- `incomplete`

これは実行確認ではなく、Repository capability presenceです。

### exactShaCi

Full-stack template CIのGitHub Actions Evidenceです。

値:

- `verified`
- `pending`
- `failed`
- `unverified`

### browserE2E

Browser E2E WorkflowのEvidenceです。

Frontend変更がないPRではWorkflowが実行されない場合があります。その場合は成功扱いにせず`unverified`とします。

### previewRemote

以下の実Preview Resource向けWorkflowを別々に確認します。

- D1 Preview Recovery Rehearsal
- D1 Preview Performance Benchmark

両方の成功Evidenceが対象evidence SHAに存在する場合だけ、集約状態を`verified`とします。

どちらか未実行なら`unverified`です。

### production

Productionは通常CIやWorkflow fileの存在だけでは`verified`にしません。

Productionを`verified`にするには、既存のRelease Evidence Bundleを明示的に入力し、次を満たす必要があります。

- `environment = production`
- `deployedSha`が対象SHAと一致
- `evidenceStatus = complete`
- deploy / security / smoke / migration / schemaがすべてverified

Release Evidenceを指定しない場合は、Productionは必ず`unverified`です。

## 4. Capability View

Status JSONはFoundationごとに2つの状態を分けます。

```json
{
  "repository": {
    "status": "present"
  },
  "verification": {
    "status": "verified"
  }
}
```

代表Capability:

- Shared Runtime / HTTP / Security
- Data / Migration / Schema
- Auth / Authorization / Integrity / Audit
- API Contract / Collection Query / Versioning
- Frontend Shell / Browser E2E
- Recovery Safety
- Performance Safety
- Production Delivery / Release Evidence
- Supply-chain Security

Repository presenceだけで確認するFoundationは`implemented`、実行Evidenceを要求するFoundationはCI結果に応じて`verified / failed / pending / implemented`となります。

`implemented`は「存在するが、この対象SHAに対する実行Evidenceは確認できていない」という意味です。

## 5. 実行方法

### Generator self-test

```bash
npm run runtime-evidence:validate
```

Networkへ接続せず、Status分類ロジックをfixtureで確認します。

### GitHub Evidenceを含めて生成

```bash
GITHUB_TOKEN=... npm run runtime-evidence:status -- \
  --repository owner/repository \
  --target-sha <40-char-sha> \
  --output artifacts/runtime-evidence/status.json
```

TokenはGitHub Actionsのread-only `github.token`を想定します。

Status generatorが利用するGitHub操作はGETのみです。

### Production Release Evidenceを含める

```bash
npm run runtime-evidence:status -- \
  --repository owner/repository \
  --target-sha <40-char-sha> \
  --release-evidence artifacts/release-evidence.json \
  --output artifacts/runtime-evidence/status.json
```

Release Evidenceを与えても、対象SHAや必須checkが一致しなければProductionは`unverified`のままです。

## 6. GitHub Actions

`.github/workflows/runtime-evidence-status.yml` は`workflow_dispatch`専用です。

入力:

- `target_sha`: 40文字のcommit SHA

権限:

- `contents: read`
- `actions: read`

Workflowは対象SHAをcheckoutし、Repository / GitHub Actions EvidenceからStatus JSONを生成してArtifactとして保存します。

このWorkflowから次の操作は行いません。

- Deploy
- D1 migration
- Preview benchmark
- Recovery rehearsal
- Production smoke
- Rollback
- GitHub Issue / PR更新

Remote Resourceを変更しないread-only Workflowです。

## 7. Production / Previewの注意

`Runtime Evidence Status`はRemote検証そのものを実施しません。

Preview RecoveryやPerformanceが未確認なら、それを実行するかどうかは別のHuman Gateで判断します。

Productionも同様です。Statusを`verified`にするためだけにProduction操作を自動実行してはいけません。

## 8. Generic Workflow Statusとの境界

Upstream Generic TemplateのWorkflow Statusは、Issue / Branch / PR / CI / Human Gate等の**開発作業の現在地**を扱います。

このFull-stack Runtime Evidence Statusは、D1 / Browser / Recovery / Performance / Production Delivery等の**実装Capabilityの検証状態**を扱います。

両方とも`authoritative: false`であり、GitHubの直接Evidenceを置き換えません。

## 9. Out of Scope

- 手更新のstatus fileを正本にすること
- External DBへの状態保存
- Production / Preview操作の自動実行
- 未取得Evidenceの推測補完
- Product固有SLA / SLO判定
- Generic Template Workflow Statusの置換
