# API Governance

この文書は、一覧APIの共通Query契約と、HTTP APIの互換性・Versioning方針を定義します。

Templateの目的は、Product固有の検索条件やrelease cadenceをCoreへ固定することではありません。HTTP境界で壊れやすい部分だけを共通化し、Project側が安全に拡張できる土台を提供します。

## 1. Collection Query Contract

一覧APIでは、以下のquery parameterを共通契約として扱います。

- `cursor`: 次ページ取得用のopaque cursor
- `limit`: 1回の最大取得件数
- `sort`: public API上のsort key
- `direction`: `asc` または `desc`
- `filter.<key>`: Projectが許可したfilter key。複数値は同じparameterを繰り返す

例:

```text
GET /api/example-resources?limit=50&sort=created&direction=desc&filter.status=open&filter.status=closed
```

### 1.1 limit

- Projectは`defaultLimit`と`maxLimit`を定義する
- `limit`は1以上の安全な整数でなければならない
- `maxLimit`を超える取得はvalidation errorとする
- 無制限取得をTemplate標準にしない

### 1.2 cursor

Cursorはclientから受け取った文字列をそのままDB条件へ使わない。

**Project MUST verify decoded cursor** before using it for data access.

Templateは、Projectが注入した`decodeCursor`を通してcursorを検証する。署名・MAC・暗号化・version token・構造検証など、cursorの具体方式はProjectが選択する。

- 空cursorは無効
- 長すぎるcursorは無効
- decodeに失敗したcursorは無効
- DB offset paginationをTemplate標準として強制しない
- cursor内部へraw SQL columnや秘密情報を露出しない

### 1.3 sort

`sort`で受け取る値は、Projectが公開API用に定義したallowlist tokenだけを許可する。

```ts
allowedSortKeys: ["created", "name", "id"]
```

これはDB column名ではなくpublic contract上のtokenであり、Infrastructure層で実際のDB columnへmappingする。

一覧順序は必ず決定的でなければならない。Projectは`stableTieBreaker`として、一意順序を確定できるpublic sort tokenを定義する。

例:

```text
requested sort: created desc
stable tie-breaker: id asc
actual ordering: created desc, id asc
```

同じ値が多数存在するsort keyだけでpageを送ると、更新タイミングによって重複・欠落が起こり得るため、**stable tie-breaker**を必須とする。

### 1.4 filter

filterは`filter.<public-key>`形式で受け取る。

- Projectが許可したfilter keyだけを受け付ける
- 未知のfilter keyはvalidation error
- 空値はvalidation error
- 値の意味検証はProject側validatorを追加できる
- Product固有filter vocabularyをCoreへ固定しない

例:

```text
filter.status=open
filter.owner=team-a
```

### 1.5 validation error

Collection Query parserはHTTP Responseを直接生成せず、既存の`ValidationIssue[]`へmappingする。

これによりWorker側では既存の`validationErrorResponse(...)`を再利用でき、body validationとquery validationでerror envelopeを分裂させない。

代表code:

- `collection_query.invalid_cursor`
- `collection_query.invalid_limit`
- `collection_query.unknown_sort`
- `collection_query.invalid_sort_direction`
- `collection_query.unknown_filter`
- `collection_query.invalid_filter`
- `collection_query.duplicate_parameter`

### 1.6 response metadata

次ページがある場合は既存のshared response envelopeを利用する。

```json
{
  "meta": {
    "pagination": {
      "nextCursor": "opaque-next-cursor",
      "limit": 50,
      "hasMore": true
    }
  }
}
```

`hasMore`は`nextCursor`の有無と矛盾させない。

## 2. API Compatibility Policy

API変更は、まず「互換性があるか」を判断する。Version番号を増やすこと自体を目的にしない。

### 2.1 non-breaking change

原則として既存clientを修正せず利用できる変更。

例:

- 新しいendpoint追加
- optional request field追加
- optional response field追加
- accepted valueの拡張

ただし既存clientがunknown fieldを拒否する特殊契約を持つ場合などは、Project側でより厳しく判定してよい。

### 2.2 breaking change

既存clientが修正なしでは正しく動かなくなる可能性がある変更。

例:

- endpoint削除
- request / response field削除
- field名変更
- field type変更
- optional fieldをrequiredへ変更
- accepted valueの縮小
- Authentication / Authorization requirement変更
- HTTP status / error semantics変更
- pagination semantics変更

**silent breaking changeは禁止する。**

既存versionへbreaking changeを黙って投入せず、migrationまたはversion分離を明示的に選択する。

## 3. Version識別方式

Templateはversionの運び方を1つに固定しない。

Projectは次のいずれかを選択できる。

- `none`: version分離不要。単一versionのみ
- `url`: `/api/v1/...` 等のURL方式
- `header`: `X-Api-Version` 等のHeader方式

Coreの`ApiVersionPolicy`はtransport-neutralであり、URL解析やHeader読取そのものはProject / HTTP adapter側で行う。

Version tokenを取り出した後、`resolveApiVersion(...)`でsupported/default/deprecationを共通判定する。

## 4. current / default version

- `currentVersion`: 新規開発で現在基準とするversion
- `defaultVersion`: clientが明示指定しなかった場合に解決するversion
- どちらも`supportedVersions`に含める
- `strategy: none`ではsupported versionは1件のみ

currentとdefaultを分けられる設計にしているが、理由なく別versionにしない。

## 5. Deprecation Contract

古いversionを廃止予定にする場合、最低限以下を記録する。

- 対象version
- deprecation message
- migration guideまたは移行先
- removal condition

日付だけで機械的に削除することをTemplate標準にはしない。外部client、業務影響、release evidence等をProject側で確認し、削除条件を満たしてから除去する。

### Migration example

```ts
createApiVersionPolicy({
  strategy: { kind: "header", headerName: "X-Api-Version" },
  supportedVersions: ["2026-01", "2026-10"],
  currentVersion: "2026-10",
  defaultVersion: "2026-10",
  deprecations: [{
    version: "2026-01",
    message: "Migrate to 2026-10",
    removalCondition: "registered clients migrated and release approval recorded",
  }],
});
```

## 6. Preview / Production invariant

**Preview and Production MUST use the same API version contract for the same release candidate.**

Previewだけ新version、Productionだけ旧versionのように契約をずらすと、Previewで通った検証がProductionの安全性を証明しなくなる。

環境差として許可するのはbinding、secret、host等のruntime configurationであり、同一release candidateのAPI compatibility policyそのものは一致させる。

## 7. Out of Scope

このFoundationでは以下を扱わない。

- full-text search
- Product固有検索DSL
- GraphQL
- API Gateway製品の固定
- client自動migration
- Product固有support期間
- Product固有release cadence

## 8. Review checklist

Collection API追加時:

- public sort tokenとDB columnを分離したか
- `maxLimit`を設定したか
- client cursorを検証しているか
- stable tie-breakerが一意順序を確定できるか
- unknown sort / filterをfail closedで扱うか
- pagination metadataがshared response envelopeと整合するか

API変更時:

- breaking / non-breakingを分類したか
- breakingなら既存versionへsilent投入していないか
- deprecation noticeとremoval conditionを記録したか
- Preview / Productionで同一contractか
- Project固有のrelease cadenceをTemplateへ持ち込んでいないか
