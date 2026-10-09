/**
 * The WORKHUB login client only checks /api/auth/login status, then resolves
 * authentication through /api/auth/me. Playwright Response.json()/finished()
 * blocked every Preview case at HTTP 200, even when the UI might succeed.
 *
 * Verify what the real browser needs: authenticated home UI + server-authorized
 * /api/auth/me with the exact expected persona. This does NOT claim the login
 * response body's transport has completed, nor fix unattributed upstream 503.
 */
export interface PreviewAuthenticationProbe {
  check(): Promise<unknown>;
}

export class PreviewLoginVerificationError extends Error {
  constructor(readonly kind: "timeout" | "probe_failed" | "invalid_session") {
    super(kind === "timeout"
      ? "Preview browser authentication verification did not finish within the deadline"
      : kind === "invalid_session"
        ? "Preview browser session did not match the expected authenticated persona"
        : "Preview browser authentication state could not be verified");
    this.name = "PreviewLoginVerificationError";
  }
}

export const ensurePreviewLoginAuthenticated = async (
  probe: PreviewAuthenticationProbe,
  expectedUserId: string,
  timeoutMs = 8_000,
): Promise<void> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !expectedUserId) {
    throw new RangeError("Expected user ID and positive Preview authentication deadline are required");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PreviewLoginVerificationError("timeout")), timeoutMs);
  });
  try {
    const payload = await Promise.race([probe.check(), deadline]);
    if (typeof payload !== "object" || payload === null || !("authenticated" in payload)
      || payload.authenticated !== true || !("user" in payload)
      || typeof payload.user !== "object" || payload.user === null
      || !("id" in payload.user) || payload.user.id !== expectedUserId) {
      throw new PreviewLoginVerificationError("invalid_session");
    }
  } catch (error) {
    if (error instanceof PreviewLoginVerificationError) throw error;
    // A browser/transport error can contain private response data: never print it.
    throw new PreviewLoginVerificationError("probe_failed");
  } finally {
    if (timer) clearTimeout(timer);
  }
};
