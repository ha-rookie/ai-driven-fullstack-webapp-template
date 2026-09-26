interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({ status: "ok" });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/health/database"
    ) {
      try {
        const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        return row?.ok === 1
          ? json({ status: "ok" })
          : json({ status: "unavailable" }, { status: 503 });
      } catch {
        return json({ status: "unavailable" }, { status: 503 });
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json(
        { error: { code: "not_found", message: "API route not found" } },
        { status: 404 },
      );
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
