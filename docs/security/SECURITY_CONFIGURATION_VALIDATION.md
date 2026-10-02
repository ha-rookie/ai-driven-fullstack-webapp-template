# Security Configuration Validation

## Purpose

`npm run security:validate` validates non-secret Production/Preview security configuration before deploy or migration workflows proceed. It is a stop-condition control, not a runtime penetration test and not a Cloudflare account-wide audit.

## Input boundary

The validator reads a JSON snapshot supplied by the Project/deploy pipeline. Do not commit real Production identifiers, origins, credentials, tokens, or secret values to the Template repository.

Expected snapshot shape:

```json
{
  "schemaVersion": 1,
  "environment": "production",
  "resources": {
    "primaryD1": { "name": "...", "id": "..." },
    "counterpartD1": { "name": "...", "id": "..." }
  },
  "http": {
    "allowedOrigins": ["https://app.example.invalid"],
    "cookie": { "secure": true, "httpOnly": true, "sameSite": "Lax" },
    "contentSecurityPolicy": "..."
  },
  "session": {
    "idleTimeoutSeconds": 1800,
    "touchIntervalSeconds": 300
  },
  "runtime": { "debug": false, "devMode": false }
}
```

`primaryD1` is the resource for the environment being validated. `counterpartD1` is the opposite Preview/Production resource and exists only to verify separation.

## Checks

The baseline fails closed for:

- unsupported snapshot schema or environment
- missing/placeholder D1 name or id
- Preview and Production D1 sharing the same name or id
- missing, wildcard, null, non-canonical, or non-HTTPS allowed origins
- session cookies without `Secure` / `HttpOnly` or with a disallowed `SameSite`
- missing required CSP directives or forbidden unsafe CSP fragments
- invalid session idle/touch parameters
- debug/development flags enabled

Policy values live in `config/security-validation-policy.json` so Projects can review changes as code. Core does not inspect or print secret values.

## Usage

```text
npm run security:validate -- --config=/path/to/security-snapshot.json
```

Exit codes:

- `0`: validation passed
- `1`: security configuration failed policy
- `2`: validator input/usage error

The report prints check identifiers and safe error descriptions only. It does not echo D1 ids, names, origins, credentials, tokens, or configuration values.

## CI and pre-deploy reuse

Repository CI runs `--self-test` with in-memory fixtures. It does not validate or require real Production values. Production Delivery and Migration Preflight workflows should build their snapshot from their own approved configuration source and invoke the same command before any mutating step.

The current `wrangler.jsonc` intentionally contains replacement placeholders; therefore it is a template input, not Production validation evidence.

## Scope boundary

This control does not:

- prove runtime security
- audit Cloudflare account settings outside the supplied snapshot
- validate that a secret is cryptographically strong
- fix unsafe configuration automatically
- define every Product-specific security policy
- perform deploys, migrations, or Production D1 mutations
