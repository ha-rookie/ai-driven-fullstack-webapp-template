import { useEffect, useState } from "react";

type HealthState = "checking" | "ok" | "error";

export default function App() {
  const [health, setHealth] = useState<HealthState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
        const payload = (await response.json()) as { status?: string };
        setHealth(payload.status === "ok" ? "ok" : "error");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHealth("error");
      });

    return () => controller.abort();
  }, []);

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "64px 24px",
        fontFamily: "system-ui, sans-serif",
        lineHeight: 1.6,
      }}
    >
      <p style={{ fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Bootstrap
      </p>
      <h1>AI-driven Full-stack Web App Template</h1>
      <p>
        React SPA and Cloudflare Worker are connected. D1, authentication,
        authorization, concurrency, and audit are added by later issues.
      </p>
      <p>
        API health: <strong>{health}</strong>
      </p>
    </main>
  );
}
