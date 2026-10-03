# Feature Flag Rollout Recipe

## Use when

新機能をLocal / Test / Preview / Productionで段階的に有効化したいときに使います。

## Inputs

作業前に次を確定します。

- Flag key
- 対象機能とFlagを外した後の恒久状態
- default値
- Previewで確認する項目
- Productionで有効化する判断条件
- 問題時にFlagをOFFへ戻したときの挙動
- DB migrationやAuthorizationへの影響

## Stop Conditions

次の場合はFlag追加だけで先へ進めません。

- Flag OFFでも新schemaが必須になり、旧codeとの互換性がない
- FlagでAuthorizationを代替しようとしている
- Preview / Productionの環境識別が曖昧
- Production設定変更の担当・確認方法が未決定
- OFFへ戻しても安全な状態に戻らない

## Steps

1. `defineFeatureFlags` にProject固有keyを追加する
2. 新機能ならdefaultを原則falseにする
3. server-sideの共通Provider経由で判定する
4. Flag OFF path / ON pathの両方をtestする
5. Local / Testで検証する
6. Preview設定だけtrueにする
7. Previewで機能・既存機能・権限境界を確認する
8. Production deploy時点では必要に応じてfalseを維持する
9. Human判断でProduction設定をtrueへ変更する
10. 問題時はfalseへ戻して既存pathを確認する
11. rollout完了後にFlag削除Issueが必要か判断する

## Validation

最低限、次を確認します。

- 未設定時の挙動
- Preview=true / Production=falseの分離
- invalid valueの拒否
- Flag OFF時に旧機能が壊れない
- Flag ON時に新機能が動く
- AuthorizationはFlagと独立してserver-sideで機能する
- migrationを伴う場合は旧/new code双方との互換性を別途確認する

## Evidence

PR / Release evidenceには必要に応じて次を残します。

- Flag key
- default値
- Previewで使用した値
- Preview確認結果
- Production有効化前の判断条件
- Production設定変更の記録
- rollbackとしてOFFへ戻す手順

FlagのSecret値は存在しないため、Flag値そのものを機密情報として扱う必要は通常ありません。ただし、未公開機能名が機密情報になるProjectではkey名の扱いもProject policyに従います。

## Do Not

- Preview設定をProductionへ自動fallbackしない
- Flagをuser permissionとして使わない
- percentage rolloutやuser segmentationをこのBaselineへ追加しない
- normal PR CIからProduction Flagを自動変更しない
- rollout完了済みFlagを無期限に残し続けない

## Sources

- `../FEATURE_FLAGS.md`
- `../RUNTIME_PRIMITIVES.md`
- `../AUTHORIZATION_DESIGN.md`
- `../OPERATION_MODE.md`
