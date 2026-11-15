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
