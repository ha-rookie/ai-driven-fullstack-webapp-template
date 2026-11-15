/**
 * Server-side AI boundary. Do not import this module into client bundles with
 * provider credentials; adapters must remain in trusted server-side code.
 * Issue #277: deliberately excludes orchestration and automatic fallback.
 */
export type AITextRequest = Readonly<{
  model: string;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
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

/** Safe classification without including upstream messages, bodies or headers. */
export function mapAIProviderError(status: number | undefined, aborted = false): AIProviderError {
  if (aborted) return new AIProviderError("timeout");
  if (status === 400 || status === 422) return new AIProviderError("invalid_request");
  if (status === 401 || status === 403) return new AIProviderError("unauthorized");
  if (status === 429) return new AIProviderError("rate_limited");
  if (status === 408 || status === 504) return new AIProviderError("timeout");
  if (status !== undefined && status >= 500) return new AIProviderError("unavailable");
  return new AIProviderError("invalid_response");
}

export type AIProviderSettings = Readonly<{
  providerId?: string;
  model?: string;
  timeoutMs?: number;
  /** Explicit retries only; zero by default. Never retry authorization failures. */
  maxRetries?: number;
}>;

/** Choose a provider only from a server-owned allowlist. Never accept a client factory. */
export function configureAIProvider(
  factories: Readonly<Record<string, AIProviderFactory>>,
  settings: AIProviderSettings,
): AIProvider | undefined {
  const providerId = settings.providerId?.trim();
  if (!providerId) return undefined; // AI is optional; ordinary operations remain available.
  if (!Object.hasOwn(factories, providerId)) throw new AIProviderError("not_configured");
  const factory = factories[providerId];
  if (!factory) throw new AIProviderError("not_configured");
  const base = createAIProvider(factory, settings);
  return withAIProviderPolicy(base, settings);
}

/**
 * Local timeout and bounded retries; no implicit fallback to another provider.
 * Only explicitly retryable failures are retried. Default is no retries.
 * A provider adapter must respect AbortSignal to stop upstream work on timeout.
 */
export function withAIProviderPolicy(
  provider: AIProvider,
  settings: Pick<AIProviderSettings, "timeoutMs" | "maxRetries">,
): AIProvider {
  const timeoutMs = settings.timeoutMs ?? 30_000;
  const maxRetries = settings.maxRetries ?? 0;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000 ||
      !Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
    throw new AIProviderError("invalid_request");
  }
  async function execute<T>(
    request: AITextRequest,
    invoke: (r: AITextRequest) => Promise<AIResponse<T>>,
  ): Promise<AIResponse<T>> {
    if (!request.model?.trim() || !request.prompt?.trim()) {
      throw new AIProviderError("invalid_request");
    }
    const effectiveTimeout = request.timeoutMs ?? timeoutMs;
    if (!Number.isSafeInteger(effectiveTimeout) || effectiveTimeout < 1 ||
        effectiveTimeout > 300_000) throw new AIProviderError("invalid_request");
    for (let attempt = 0; ; attempt++) {
      if (request.signal?.aborted) throw new AIProviderError("timeout");
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      request.signal?.addEventListener("abort", onAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new AIProviderError("timeout"));
          }, effectiveTimeout);
        });
        const result = await Promise.race([
          invoke({ ...request, timeoutMs: effectiveTimeout, signal: controller.signal }),
          timeout,
        ]);
        if (controller.signal.aborted) throw new AIProviderError("timeout");
        if (!result || typeof result.model !== "string") {
          throw new AIProviderError("invalid_response");
        }
        return result;
      } catch (error: unknown) {
        const safe = error instanceof AIProviderError ? error : mapAIProviderError(undefined);
        if (attempt >= maxRetries || (safe.code !== "rate_limited" && safe.code !== "unavailable")) {
          throw safe;
        }
        // No exponential retry loops; bounded and same-provider only.
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
      }
    }
  }
  return {
    generateText(request) {
      return execute(request, (r) => provider.generateText(r));
    },
    generateStructured(request) {
      return execute(request, (r) =>
        provider.generateStructured({ ...r, jsonSchema: request.jsonSchema }));
    },
  };
}
