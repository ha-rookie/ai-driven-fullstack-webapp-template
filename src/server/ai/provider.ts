/**
 * Optional server-side AI boundary. Provider SDKs and credentials belong only
 * in trusted adapters; no implicit provider or cross-provider fallback.
 */
export type AITextRequest = Readonly<{ model: string; prompt: string; timeoutMs?: number }>;
export type AIStructuredRequest = AITextRequest & Readonly<{ jsonSchema: Readonly<Record<string, unknown>> }>;
export type AIResponse<T> = Readonly<{ model: string; output: T }>;
export type AIProviderErrorCode =
  | "not_configured" | "invalid_request" | "unauthorized" | "rate_limited"
  | "timeout" | "unavailable" | "invalid_response";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  constructor(code: AIProviderErrorCode) {
    // Never include raw SDK errors, prompts, or credentials in messages.
    super(`AI provider error: ${code}`);
    this.name = "AIProviderError";
    this.code = code;
  }
}

export interface AIProvider {
  generateText(request: AITextRequest): Promise<AIResponse<string>>;
  generateStructured(request: AIStructuredRequest): Promise<AIResponse<unknown>>;
}
export type AIProviderFactory = (config: Readonly<{ model: string; timeoutMs: number }>) => AIProvider;
export type AIProviderRegistry = Readonly<Record<string, AIProviderFactory>>;
export type AIProviderConfig = Readonly<{
  provider?: string;
  model?: string;
  timeoutMs?: number;
  /** Retries only explicit transient failures, on the same selected provider. */
  retries?: number;
}>;

function validTimeout(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 300_000;
}
function validateRequest(request: AITextRequest): void {
  if (!request.model?.trim() || !request.prompt?.trim() ||
    (request.timeoutMs !== undefined && !validTimeout(request.timeoutMs))) {
    throw new AIProviderError("invalid_request");
  }
}
function safeError(error: unknown): AIProviderError {
  return error instanceof AIProviderError ? error : new AIProviderError("unavailable");
}
function isRetryable(error: AIProviderError): boolean {
  return error.code === "rate_limited" || error.code === "unavailable" || error.code === "timeout";
}

/** Normalize a known provider status without propagating potentially sensitive error text. */
export function mapAIProviderHttpStatus(status: number): AIProviderError {
  if (status === 400 || status === 422) return new AIProviderError("invalid_request");
  if (status === 401 || status === 403) return new AIProviderError("unauthorized");
  if (status === 408 || status === 504) return new AIProviderError("timeout");
  if (status === 429) return new AIProviderError("rate_limited");
  if (status >= 500 && status <= 599) return new AIProviderError("unavailable");
  return new AIProviderError("invalid_response");
}

/**
 * Bounded timeout. Promise.race cannot cancel an underlying provider request:
 * adapters should additionally implement transport-level AbortSignal/timeout.
 */
async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new AIProviderError("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Explicitly select an adapter via server configuration. Never read env vars
 * or automatically route data to another provider.
 */
export function createConfiguredAIProvider(
  registry: AIProviderRegistry,
  config: AIProviderConfig,
): AIProvider {
  const providerName = config.provider?.trim();
  const model = config.model?.trim();
  if (!providerName || !model || !Object.prototype.hasOwnProperty.call(registry, providerName)) {
    throw new AIProviderError("not_configured");
  }
  const timeoutMs = config.timeoutMs ?? 30_000;
  const retries = config.retries ?? 0;
  if (!validTimeout(timeoutMs) || !Number.isSafeInteger(retries) || retries < 0 || retries > 2) {
    throw new AIProviderError("invalid_request");
  }
  const adapter = registry[providerName]({ model, timeoutMs });
  async function invoke<T>(request: AITextRequest, operation: () => Promise<AIResponse<T>>): Promise<AIResponse<T>> {
    validateRequest(request);
    if (request.model !== model) throw new AIProviderError("invalid_request");
    const effectiveTimeout = request.timeoutMs ?? timeoutMs;
    let lastError: AIProviderError = new AIProviderError("unavailable");
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const result = await withTimeout(operation, effectiveTimeout);
        if (!result || result.model !== model) throw new AIProviderError("invalid_response");
        return result;
      } catch (error) {
        lastError = safeError(error);
        if (!isRetryable(lastError) || attempt === retries) throw lastError;
      }
    }
    throw lastError;
  }
  return {
    generateText(request) {
      return invoke(request, async () => {
        const response = await adapter.generateText(request);
        if (typeof response?.output !== "string") throw new AIProviderError("invalid_response");
        return response;
      });
    },
    generateStructured(request) {
      if (!request.jsonSchema || typeof request.jsonSchema !== "object" || Array.isArray(request.jsonSchema)) {
        throw new AIProviderError("invalid_request");
      }
      return invoke(request, () => adapter.generateStructured(request));
    },
  };
}

/** Backward-compatible single-adapter factory, with identical safe defaults. */
export function createAIProvider(
  factory: AIProviderFactory | undefined,
  config: Readonly<{ model?: string; timeoutMs?: number }>,
): AIProvider {
  if (!factory) throw new AIProviderError("not_configured");
  return createConfiguredAIProvider({ selected: factory }, { ...config, provider: "selected" });
}

/** Deterministic, network-free fake adapter for local development. */
export function createFakeAIProvider(text: string, structured: unknown): AIProvider {
  return {
    async generateText(request) {
      validateRequest(request);
      return { model: request.model, output: text };
    },
    async generateStructured(request) {
      validateRequest(request);
      if (!request.jsonSchema || typeof request.jsonSchema !== "object" || Array.isArray(request.jsonSchema)) {
        throw new AIProviderError("invalid_request");
      }
      return { model: request.model, output: structured };
    },
  };
}
