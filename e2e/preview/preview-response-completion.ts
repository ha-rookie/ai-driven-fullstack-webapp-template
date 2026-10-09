/**
 * A Playwright Response may expose headers (HTTP 200) even when the server or
 * upstream never finishes delivering its body. Never turn an incomplete login
 * into a successful acceptance or wait for the 30-second test timeout.
 *
 * Pure helper to unit-test bounded response completion without Playwright.
 */
export interface CompletablePreviewResponse {
  finished(): Promise<Error | null>;
}

export class PreviewLoginResponseIncompleteError extends Error {
  constructor(readonly kind: "timeout" | "transport") {
    super(kind === "timeout"
      ? "Preview login response headers arrived but response body did not finish within the deadline"
      : "Preview login response body ended with a transport error");
    this.name = "PreviewLoginResponseIncompleteError";
  }
}

export const ensurePreviewLoginResponseComplete = async (
  response: CompletablePreviewResponse,
  timeoutMs = 7_000,
): Promise<void> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Preview response completion timeout must be positive");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PreviewLoginResponseIncompleteError("timeout")), timeoutMs);
  });
  try {
    const error = await Promise.race([response.finished(), deadline]);
    if (error !== null) throw new PreviewLoginResponseIncompleteError("transport");
  } finally {
    if (timer) clearTimeout(timer);
  }
};
