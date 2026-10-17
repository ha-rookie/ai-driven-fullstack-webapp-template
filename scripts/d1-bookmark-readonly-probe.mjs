/**
 * #431 Read-only Cloudflare D1 Time Travel bookmark probe.
 * This is availability evidence ONLY, not backup/restore verification.
 * Never returns or logs the bookmark itself.
 */
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ACCOUNT = /^[0-9a-f]{32}$/i;
export async function probeD1Bookmark({ accountId, databaseId, token, timestamp, fetchImpl = fetch }) {
  if (!ACCOUNT.test(accountId ?? "") || !UUID.test(databaseId ?? "")
    || !token || typeof token !== "string") throw new TypeError("Invalid D1 probe configuration");
  if (timestamp !== undefined && (!Number.isFinite(Date.parse(timestamp))
    || new Date(timestamp).toISOString() !== timestamp)) throw new TypeError("Invalid timestamp");
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/time_travel/bookmark`);
  if (timestamp) url.searchParams.set("timestamp", timestamp);
  try {
    const response = await fetchImpl(url, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { status: "UNAVAILABLE", provesRecoverability: false };
    const body = await response.json();
    return { status: body?.success === true && typeof body?.result?.bookmark === "string"
      && body.result.bookmark.length > 0 ? "AVAILABLE" : "UNAVAILABLE",
      provesRecoverability: false };
  } catch {
    return { status: "UNAVAILABLE", provesRecoverability: false };
  }
}
