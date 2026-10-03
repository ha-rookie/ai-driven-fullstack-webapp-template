# Feature Flag Foundation

## 目的

新機能を一度に全環境へ公開せず、**Local / Test / Preview / ProductionごとにON/OFFを分けて段階的に有効化する**ための最小共通仕組みです。

このTemplateではFeature Flagを次の用途に限定します。

- 新機能をまずPreviewだけで有効にする
- Production公開前に動作確認する
- 問題があれば機能単位でOFFへ戻す
- Project固有のFlag判定をrouteやdomain codeへ散らさない

## できること

`src/shared/runtime/feature-flags.ts` は次を提供します。

- Projectが定義したFlag keyの一覧
- boolean Flag Provider
- Runtime環境ごとに分離された設定値の参照
- 未設定時の明示的なdefault
- 不正なFlag名・設定値の検出
- server-sideでのFlag判定

外部Feature Flag SaaSは必要ありません。

## Flag名

Flag keyは `lower_snake_case` に限定します。

例:

```text
example_feature
new_search
new_report_screen
```

設定名は環境ごとに自動で分離されます。

```text
FEATURE_FLAG__LOCAL__EXAMPLE_FEATURE
FEATURE_FLAG__TEST__EXAMPLE_FEATURE
FEATURE_FLAG__PREVIEW__EXAMPLE_FEATURE
FEATURE_FLAG__PRODUCTION__EXAMPLE_FEATURE
```

Previewの値をProductionへfallbackしません。

## 未設定時の挙動

ProjectはFlag定義時にdefaultを指定できます。

```ts
const flags = defineFeatureFlags({
  example_feature: {},
  existing_feature: { defaultValue: true },
});
```

`defaultValue` を省略したFlagは **false** です。

新機能の段階公開では、原則としてdefaultをfalseにします。Production設定が欠けたときに意図せず機能が有効になるのを防ぐためです。

存在しないFlag keyはProgramming Errorとして例外にします。Flag名のtypoを新しい暗黙Flagとして扱いません。

設定値は `true` / `false` だけを受け付けます。大文字小文字と前後空白は正規化しますが、`1` / `0` / `yes` / `on` など曖昧な値は拒否します。

## Server-sideで使う

Feature Flagの正本判定はserver-sideに置きます。

```ts
import {
  RuntimeConfigReader,
  createEnvironmentFeatureFlagProvider,
  defineFeatureFlags,
  parseRuntimeEnvironment,
} from "./shared/runtime";

const definitions = defineFeatureFlags({
  example_feature: {},
});

const environment = parseRuntimeEnvironment(env.RUNTIME_ENVIRONMENT);
const config = new RuntimeConfigReader({
  settings: {
    FEATURE_FLAG__PREVIEW__EXAMPLE_FEATURE:
      env.FEATURE_FLAG__PREVIEW__EXAMPLE_FEATURE,
    FEATURE_FLAG__PRODUCTION__EXAMPLE_FEATURE:
      env.FEATURE_FLAG__PRODUCTION__EXAMPLE_FEATURE,
  },
});

const featureFlags = createEnvironmentFeatureFlagProvider({
  environment,
  config,
  definitions,
});

if (featureFlags.isEnabled("example_feature")) {
  // enabled path
}
```

実Projectでは使用するFlag分だけ`Env` bindingを宣言し、Secretではなく通常設定として管理します。

## 推奨Rollout

1. Flag定義を追加する
2. defaultはfalseにする
3. Local / Testで実装と自動テストを通す
4. Previewだけtrueにする
5. Previewで機能を確認する
6. Productionはfalseのまま通常Releaseを確認する
7. Human判断でProductionをtrueにする
8. 問題があればProductionをfalseへ戻す
9. rollout完了後、恒久的にONのFlagは削除できるか検討する

Feature Flagを永続的な分岐として増やし続けないことが重要です。

## Feature Flagでは代替しないもの

### Authorization

Feature FlagがOFFだから安全、とは扱いません。

権限が必要な操作は、Flagの状態に関係なくserver-side Authorizationを必ず通します。

```text
Feature Flag = 機能を公開するか
Authorization = その利用者が実行してよいか
```

責務は別です。

### Maintenance / Read-only Mode

障害時にアプリ全体の更新を止める場合はOperation Modeを使います。Feature Flagは個別機能の段階公開用です。

### Database migration safety

Flagで画面を隠していても、互換性のないDB migrationを安全にはできません。Schema変更は既存のMigration / Production Preflightを使います。

## Out of Scope

このFoundationには次を含めません。

- userごとのFlag
- percentage rollout
- A/B test
- tenant segmentation
- 管理画面からのFlag変更
- 外部Feature Flag SaaS
- 自動Production切替

これらが必要なProjectでは、このProvider境界を維持したままProject固有adapterを追加します。

## 安全原則

- PreviewとProductionを同じ設定キーにしない
- Productionが未設定ならPreview値を引き継がない
- Flag値をSecretとして扱わない
- Feature FlagをAuthorizationの代替にしない
- Remote / Production設定変更は通常PR mergeとは別のHuman Gateとして扱う
- Production rollout成功後は不要なFlagを放置しない

## 関連

- `src/shared/runtime/feature-flags.ts`
- `src/shared/runtime/config.ts`
- `src/shared/runtime/environment.ts`
- `docs/OPERATION_MODE.md`
- `docs/PRODUCTION_DELIVERY.md`（存在する場合はRelease手順を正本とする）
- `docs/recipes/FEATURE_FLAG_ROLLOUT.md`
