# Shared Runtime Primitives

## Purpose

Shared Runtime Primitives provide a deliberately small boundary around runtime concerns that otherwise tend to leak directly into feature code:

- current time
- ID generation
- runtime configuration
- environment identity

They are not a dependency-injection framework and do not replace Project-specific configuration design.

## Clock

`Clock` exposes only `now(): Date`.

The default `systemClock` uses the runtime clock. `createFixedClock(...)` is available for deterministic tests and returns a fresh `Date` on every call so callers cannot mutate the stored instant.

Persisted and exchanged timestamps should use UTC / ISO-8601. Display timezone conversion remains a Project/UI concern.

## ID generation

`IdGenerator` exposes only `generate(): string`.

The default `cryptoIdGenerator` delegates to `crypto.randomUUID()`. It is appropriate for generic correlation/request identifiers. Product-specific ID formats, database keys, and human-readable numbering remain Project decisions.

Request Correlation uses this shared generator only as the fallback after trusted `CF-Ray` and validated `x-request-id` handling. The existing request-ID priority does not change.

## Runtime configuration

`RuntimeConfigReader` accepts two explicit sources:

```ts
new RuntimeConfigReader({
  settings: {
    APP_NAME: "example",
  },
  secrets: {
    API_TOKEN: "...",
  },
});
```

The API intentionally distinguishes:

- `optionalSetting` / `requiredSetting`
- `optionalSecret` / `requiredSecret`

This is a responsibility boundary, not a secret manager. The caller is still responsible for supplying secrets from an appropriate platform mechanism.

Validation errors include the configuration key but never the configuration value. Generic positive-integer parsing is provided because it is repeatedly needed by runtime/security configuration.

Do not place Product-specific configuration schemas in this shared layer.

## Runtime environment

The baseline environment vocabulary is:

```text
local
 test
preview
production
```

`parseRuntimeEnvironment(...)` accepts only these explicit values and rejects unknown aliases such as `prod`.

The Template does not currently require a global `APP_ENV` setting. The primitive exists so Production Delivery and Security Configuration validation can adopt a consistent vocabulary without forcing an environment-setting migration into existing deployments.

Preview and Production must never be treated as interchangeable fallbacks.

## Current adoption

The initial adoption is intentionally narrow:

- Audit Logger default timestamp → `systemClock`
- Request Correlation fallback UUID → `cryptoIdGenerator`

Existing injection points remain intact, so current tests and runtime behavior do not change.

## Non-goals

This foundation does not provide:

- DI container or service locator
- feature flag service
- secret manager integration
- timezone/calendar business rules
- automatic environment detection
- Product-specific configuration schemas
- global mutable test clock/configuration
