# AI Provider boundary (Issue #277, first implementation slice)

This server-side contract is **optional**. Existing business routes do not initialize an AI provider and continue operating without one. No real provider, API key, network call, agent runtime, automatic fallback, or production configuration is included.

- `src/server/ai/provider.ts` exports `AIProvider`, text/structured request and response types, safe error codes, an explicit provider factory, and a deterministic fake.
- A server integration must supply its own provider adapter and an explicit model identifier from trusted configuration. No default provider/model is selected.
- Keep SDK imports, API keys, and provider credentials strictly server-side. Do not serialize them into browser bundles, errors, telemetry, or audit records.
- Map SDK failures to the safe `AIProviderErrorCode` enum without forwarding raw SDK error messages. In particular, never log prompts, keys, or provider response bodies by default.
- Provider-specific capabilities (tool calls, multimodal output, streaming, provider-defined structured output guarantees) are outside the minimal contract.
- There is no automatic cross-provider retry: moving data to another provider requires a separate data-egress decision.
- `createAIProvider(undefined, {model: "example"})` fails closed with `not_configured`; the caller must treat this as an unavailable optional AI feature, not a failure of ordinary business operations.

Example for local development only:

```ts
import { createAIProvider, createFakeAIProvider } from "./src/server/ai/provider";

const provider = createAIProvider(
  () => createFakeAIProvider("demo response", { status: "demo" }),
  { model: "fake-local" },
);
const result = await provider.generateText({ model: "fake-local", prompt: "demo" });
```

**Status:** First contract/fake slice only; #277 acceptance is **not complete**. Real adapters, provider-specific timeout/retry/error mapping, configuration wiring, and contract tests remain outstanding. No tests were added or deliberately run in this slice at the user's request; mandatory repository checks remain unchanged.

## Server-side configuration and operational behavior

```ts
import { configureAIProvider, createFakeAIProvider } from "../src/server/ai/provider";

const provider = configureAIProvider(
  { fake: () => createFakeAIProvider("sample", { ok: true }) },
  { providerId: "fake", model: "fake-local", timeoutMs: 10_000, maxRetries: 0 },
);
// undefined when providerId is absent: business features remain available.
```

Provider IDs are matched against a server-owned factory allowlist; unknown IDs fail closed. Timeouts default to 30 seconds and are capped at 300 seconds. Retries default to zero, are capped at two, and apply only to rate-limited/unavailable errors on the **same provider**. There is no automatic cross-provider fallback. Cancellation is passed via AbortSignal; adapters must honor it to stop network work. The local timeout stops waiting but cannot guarantee termination of an adapter that ignores AbortSignal.

`mapAIProviderError(status, aborted)` maps HTTP status categories to safe errors. SDK adapters must translate their own transport failures without exposing upstream messages, prompts, headers, or credentials. Fake Provider uses the same interface and requires no external connection.

Remaining: real SDK adapters, integration into server routes, contract verification, and operational acceptance. Production credentials, routing and egress approval are not part of this PR.

## Configuration and error handling (second slice)

Use `createConfiguredAIProvider(registry, { provider, model, timeoutMs, retries })` in **server-only** integration code. `provider` must match an explicitly registered adapter; no default or automatic provider fallback is selected. `retries` defaults to zero and is limited to 0–2; only `rate_limited`, `unavailable`, and `timeout` are retried on the **same** adapter. Retry is suitable only when the caller has assessed idempotency and duplicate billing/request effects. Do not use it for side-effecting provider calls without safeguards.

`mapAIProviderHttpStatus(status)` maps known HTTP statuses into safe public codes. Adapters must never pass raw SDK errors, request bodies, provider responses, or credentials to application logs or client messages. Unknown thrown errors are mapped to `unavailable`.

`timeoutMs` is a bounded promise deadline (1–300000 ms). This does **not** abort an in-flight network request. Real HTTP adapters must implement transport cancellation/AbortSignal and enforce their own request deadline. Because timed-out requests may continue, automatic retries can duplicate calls and charges; configure `retries: 0` until a real adapter's cancellation/idempotency contract is verified.

Example:

```ts
const provider = createConfiguredAIProvider(
  { fake: () => createFakeAIProvider("demo response", { status: "demo" }) },
  { provider: "fake", model: "fake-local", timeoutMs: 3000, retries: 0 },
);
```

This is a contract and Fake Provider integration only. No live OpenAI/Anthropic/Google adapter, secret, deployment setting, or real provider connectivity has been configured. New tests and optional E2E were not added/run at user request; required CI is unchanged.
