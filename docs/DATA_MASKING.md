# 個人情報などを一部伏せて表示する仕組み

## 目的

このFoundationは、**参照できるデータでも、利用者や利用目的によっては値の一部だけ見せたい**場合に使う。

たとえば同じ利用者情報でも、

- 本人や担当管理者にはメールアドレスをそのまま表示する
- 一般担当者には `a***@example.com` のように一部だけ表示する
- 関係のない利用者には項目自体を返さない

といった表示制御を、画面ごとの場当たり実装にせず共通化する。

技術上の識別名は **Data Masking Utility**。

## 重要な責務境界

Data MaskingはAuthorizationの代わりではない。

```text
認証
  ↓
そのResourceを参照してよいかをAuthorizationで判定
  ↓
参照可能なResourceについて、各Fieldをどこまで見せるかをMasking Policyで判定
  ↓
API response DTOへ reveal / mask / omit を適用
  ↓
Frontend
```

「画面で伏せ字にしたから安全」ではない。元値を利用者へ渡してはいけない場合は、**Worker/API responseを作る時点でmaskまたはomitする**。

## 共通で提供するもの

`src/shared/data-masking/` に以下を置く。

### `maskEmail()`

メールアドレスを表示用に部分マスクする。

```text
alice@example.com
↓
a***@example.com
```

入力がメール形式として不完全な場合は、元値をそのまま返さず `***` とする。

### `maskPhone()`

電話番号の最後4桁だけを残して、それ以前の数字を伏せる。

```text
090-1234-5678
↓
***-****-5678
```

4桁以下の番号は全桁を伏せる。数字を含まない異常な入力も元値をそのまま返さない。

### Field Policy

各ProjectがFieldごとに次のいずれかを返す。

- `reveal`: 元値を表示してよい
- `mask`: マスク後の値だけ表示してよい
- `omit`: 項目自体を返さない

Templateは「managerならreveal」などProduct固有Roleを決めない。

### `presentSensitiveString()`

Policy判断とMask処理を分離して適用する。

安全側の挙動を優先し、以下はすべて `omit` になる。

- Policy評価が例外になった
- runtimeで未知のdecisionが返った
- maskerが例外になった
- `mask` 指定なのにmaskerが元値をそのまま返した

**元値を返せるのは明示的な `reveal` だけ**。

### `applyStringFieldPolicies()`

flatなAPI response DTOへ複数FieldのPolicyをまとめて適用する。

Field Policyを指定していない項目はそのままコピーする。Sensitive FieldとしてPolicyを指定した項目でruntime型が想定外だった場合は、その項目を削除する。

## API responseへの適用例

例として、Project側に次のDTOがあるとする。

```ts
const user = {
  id: "user-1",
  displayName: "Alice",
  email: "alice@example.com",
  phone: "090-1234-5678",
};
```

Project側Policy:

```ts
const piiPolicy = {
  decide: (context: { canRevealPii: boolean; canSeeMaskedPii: boolean }) => {
    if (context.canRevealPii) return "reveal" as const;
    if (context.canSeeMaskedPii) return "mask" as const;
    return "omit" as const;
  },
};
```

Workerでresponseを返す直前に適用する。

```ts
const responseBody = applyStringFieldPolicies(
  user,
  context,
  {
    email: { policy: piiPolicy, mask: maskEmail },
    phone: { policy: piiPolicy, mask: maskPhone },
  },
);
```

`canSeeMaskedPii = true` の場合:

```json
{
  "id": "user-1",
  "displayName": "Alice",
  "email": "a***@example.com",
  "phone": "***-****-5678"
}
```

どちらも許可されない場合:

```json
{
  "id": "user-1",
  "displayName": "Alice"
}
```

## Project側で決めること

Templateでは以下を固定しない。

- どのFieldをPII / sensitive dataとして扱うか
- どのRole / permission / relationship / purposeならrevealできるか
- mask表示まで許可する条件
- omitすべき条件
- 氏名、住所、社員番号、顧客番号などProject固有形式のmask方法
- 監査上、reveal操作をAudit Eventへ残すか

## Log redactionとの違い

`src/shared/logging/redaction.ts` は、Application LogやAuditへ秘密情報を不用意に残さないための仕組み。

Data Maskingは、**業務APIで利用者へ返す表示値を制御する仕組み**。

目的が異なるため、同じutilityへ統合しない。

## やってはいけないこと

- Frontendだけでmaskし、APIには元値を返す
- Authorizationを通していないResourceをMaskingだけで表示する
- Product固有Role名をTemplate Coreへ固定する
- `mask` 判定で元値を返すcustom maskerを許容する
- DB暗号化、column-level security、tokenizationの代替として扱う
- どのFieldがPIIかをTemplateが自動推測する

## Out of Scope

- encryption at rest
- DB column-level security
- tokenization / reversible pseudonymization
- Product固有PII一覧
- nested objectを自動走査する汎用PII scanner
- FrontendだけをSecurity Boundaryにする実装
