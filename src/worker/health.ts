export type HealthStatus = "ok" | "unavailable";

export interface HealthResponseBody {
  status: HealthStatus;
  component: "runtime" | "database";
}

const json = (body: HealthResponseBody, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export const handleLiveness = (): Response =>
  json({ status: "ok", component: "runtime" });

export const handleReadiness = async (
  db: D1Database,
  onUnavailable?: () => void,
): Promise<Response> => {
  try {
    const row = await db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (row?.ok === 1) {
      return json({ status: "ok", component: "database" });
    }
    onUnavailable?.();
    return json({ status: "unavailable", component: "database" }, 503);
  } catch {
    onUnavailable?.();
    return json({ status: "unavailable", component: "database" }, 503);
  }
};
