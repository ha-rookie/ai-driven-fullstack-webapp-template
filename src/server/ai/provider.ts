/**
 * Server-side AI boundary. Do not import this module into client bundles with
 * provider credentials; adapters must remain in trusted server-side code.
 * Issue #277: deliberately excludes orchestration and automatic fallback.
 */
export type AITextRequest = Readonly<{
  model: string;
  prompt: string;
  timeoutMs?: number;
}>;

export type AIStructuredRequest = AITextRequest & Readonly<{
  jsonSchema: Readonly<Record<string, unknown>>;
}>;

export type AIResponse<T> = Readonly<{
  model: string;
  output: T;
}>;

export type AIProviderErrorCode =
  | "not_configured"
  | "invalid_request"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_response";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  constructor(code: AIProviderErrorCode) {
    // Do not propagate SDK messages: they may include credentials or prompts.
    super(`AI provider error: ${code}`);
    this.name = "AIProviderError";
    this.code = code;
  }
}

export interface AIProvider {
  generateText(request: AITextRequest): Promise<AIResponse<string>>;
  generateStructured(
    request: AIStructuredRequest,
  ): Promise<AIResponse<unknown>>;
}

export type AIProviderFactory = (config: Readonly<{
  model: string;
  timeoutMs: number;
}>) => AIProvider;

/**
 * No implicit provider, network call, secret lookup, or cross-provider retry.
 * Callers must explicitly select an adapter and model in server configuration.
 */
export function createAIProvider(
  factory: AIProviderFactory | undefined,
  config: Readonly<{ model?: string; timeoutMs?: number }>,
): AIProvider {
  const model = config.model?.trim();
  if (!factory || !model) throw new AIProviderError("not_configured");
  const timeoutMs = config.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new AIProviderError("invalid_request");
  }
  return factory({ model, timeoutMs });
}

/** Deterministic fake adapter for development; never contacts a real provider. */
export function createFakeAIProvider(
  text: string,
  structured: unknown,
): AIProvider {
  return {
    async generateText(request) {
      if (!request.model.trim() || !request.prompt.trim()) {
        throw new AIProviderError("invalid_request");
      }
      return { model: request.model, output: text };
    },
    async generateStructured(request) {
      if (!request.model.trim() || !request.prompt.trim() || !request.jsonSchema) {
        throw new AIProviderError("invalid_request");
      }
      return { model: request.model, output: structured };
    },
  };
}
