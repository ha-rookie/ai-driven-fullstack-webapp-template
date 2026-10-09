/**
 * Checking Playwright Response.finished() before reading JSON was found to block
 * every Preview login even when headers reported HTTP 200 (run 37869794448).
 * Consume the same payload the application uses, with a bounded deadline.
 * Treat malformed/incomplete successful login payloads as an acceptance failure.
 */
export interface CompletablePreviewResponse {
  json(): Promise<unknown>;
}

export class PreviewLoginResponseIncompleteError extends Error {
  constructor(readonly kind: "timeout" | "transport" | "invalid_payload") {
    super(kind === "timeout"
      ? "Preview login response JSON did not complete within the deadline"
      : kind === "invalid_payload"
        ? "Preview login response JSON did not confirm authentication"
        : "Preview login response JSON could not be read");
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
    const payload = await Promise.race([response.json(), deadline]);
    if (typeof payload !== "object" || payload === null || !("authenticated" in payload)
      || payload.authenticated !== true || !("user" in payload)
      || typeof payload.user !== "object" || payload.user === null
      || !("id" in payload.user) || typeof payload.user.id !== "string") {
      throw new PreviewLoginResponseIncompleteError("invalid_payload");
    }
  } catch (error) {
    if (error instanceof PreviewLoginResponseIncompleteError) throw error;
    // Avoid logging raw malformed JSON or transport messages with user data.
    throw new PreviewLoginResponseIncompleteError("transport");
  } finally {
    if (timer) clearTimeout(timer);
  }
};
