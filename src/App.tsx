import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "./frontend/auth";
import "./workhub.css";

interface DemoPersona {
  readonly key: string;
  readonly userId: string;
  readonly displayName: string;
  readonly roleLabel: string;
  readonly homeHint: string;
}

interface DemoConfig {
  readonly demoEnabled: boolean;
  readonly personas: DemoPersona[];
  readonly demoPassword?: string;
}

const HOME_HINTS: Record<string, { role: string; hint: string }> = {
  "workhub-demo-haru": { role: "新入社員", hint: "Onboarding / 必須研修" },
  "workhub-demo-aoi": { role: "一般社員", hint: "MY WORK / 申請" },
  "workhub-demo-ren": { role: "Manager", hint: "承認Task / Team" },
  "workhub-demo-mei": { role: "経理", hint: "経費確認Queue" },
  "workhub-demo-sora": { role: "人事 / 総務", hint: "人事・総務Task" },
  "workhub-demo-kai": { role: "System Admin", hint: "System Administration" },
};

const REMEMBERED_USER_ID_KEY = "workhub.rememberedUserId";

const readRememberedUserId = (): string => {
  try {
    return localStorage.getItem(REMEMBERED_USER_ID_KEY) ?? "";
  } catch {
    return "";
  }
};

const persistRememberedUserId = (remember: boolean, userId: string): void => {
  try {
    if (remember) localStorage.setItem(REMEMBERED_USER_ID_KEY, userId);
    else localStorage.removeItem(REMEMBERED_USER_ID_KEY);
  } catch {
    // Authentication does not depend on browser storage availability.
  }
};

const loginFailureMessage = (status: number): string => {
  if (status === 401) return "ユーザーIDまたはパスワードを確認してください。";
  if (status === 429) return "ログイン試行が一時的に制限されています。しばらくしてから再度お試しください。";
  if (status === 400 || status === 413 || status === 415) return "入力内容を確認してください。";
  return "現在ログインできません。時間をおいて再度お試しください。";
};

function Brand() {
  return (
    <div className="workhub-brand" aria-label="WORKHUB CECIL WORKS Digital Workplace">
      <div className="workhub-logo" aria-hidden="true">W</div>
      <div>
        <div className="workhub-brand-name">WORKHUB</div>
        <div className="workhub-brand-subtitle">CECIL WORKS Digital Workplace</div>
      </div>
    </div>
  );
}

interface PersonaDialogProps {
  readonly personas: DemoPersona[];
  readonly onSelect: (persona: DemoPersona) => void;
  readonly onClose: () => void;
}

function PersonaDialog({ personas, onSelect, onClose }: PersonaDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="workhub-dialog-backdrop" onMouseDown={onClose}>
      <section
        className="workhub-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="persona-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="workhub-dialog-heading">
          <div>
            <p className="workhub-eyebrow">REFERENCE PERSONA</p>
            <h2 id="persona-dialog-title">デモユーザを選ぶ</h2>
          </div>
          <button className="workhub-icon-button" type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <p className="workhub-muted">
          Personaを選ぶとUser IDとデモ用Passwordを入力します。認証は省略せず、最後に「ログイン」を押してください。
        </p>
        <div className="workhub-persona-list">
          {personas.map((persona) => (
            <button
              className="workhub-persona-card"
              type="button"
              key={persona.key}
              onClick={() => onSelect(persona)}
            >
              <span className="workhub-persona-avatar" aria-hidden="true">
                {persona.displayName.slice(0, 1)}
              </span>
              <span className="workhub-persona-copy">
                <strong>{persona.displayName}</strong>
                <span>{persona.roleLabel}</span>
                <small>{persona.homeHint}</small>
              </span>
              <span className="workhub-persona-id">{persona.userId}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function LoginScreen() {
  const auth = useAuth();
  const remembered = useMemo(readRememberedUserId, []);
  const [userId, setUserId] = useState(remembered);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(remembered.length > 0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [demoConfig, setDemoConfig] = useState<DemoConfig>({ demoEnabled: false, personas: [] });
  const [personaOpen, setPersonaOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/workhub/demo-config", {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as Partial<DemoConfig>;
        if (payload.demoEnabled !== true || !Array.isArray(payload.personas)) return;
        const personas = payload.personas.filter((item): item is DemoPersona => {
          if (!item || typeof item !== "object") return false;
          const candidate = item as Partial<DemoPersona>;
          return [candidate.key, candidate.userId, candidate.displayName, candidate.roleLabel, candidate.homeHint]
            .every((value) => typeof value === "string" && value.length > 0 && value.length <= 200);
        });
        setDemoConfig({
          demoEnabled: true,
          personas,
          ...(typeof payload.demoPassword === "string" && payload.demoPassword.length <= 256
            ? { demoPassword: payload.demoPassword }
            : {}),
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, []);

  const choosePersona = (persona: DemoPersona) => {
    setUserId(persona.userId);
    setPassword(demoConfig.demoPassword ?? "");
    setMessage(null);
    setPersonaOpen(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ userId, password, remember }),
      });
      if (!response.ok) {
        setMessage(loginFailureMessage(response.status));
        return;
      }
      persistRememberedUserId(remember, userId);
      setPassword("");
      const synchronized = await auth.synchronize();
      if (synchronized.status !== "authenticated") {
        setMessage("ログイン状態を確認できませんでした。もう一度お試しください。");
      }
    } catch {
      setMessage("現在ログインできません。ネットワーク状態を確認してください。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="workhub-login-shell">
      <section className="workhub-login-story" aria-label="WORKHUB紹介">
        <div className="workhub-story-content">
          <Brand />
          <p className="workhub-story-kicker">CECIL WORKS INTERNAL PORTAL</p>
          <h1>仕事の入口を、ひとつに。</h1>
          <p className="workhub-story-lead">
            社内システムの名前ではなく、「何をしたいか」から仕事を始めるためのDigital Workplaceです。
          </p>
          <div className="workhub-story-grid" aria-hidden="true">
            <span>MY WORK</span>
            <span>REQUESTS</span>
            <span>PEOPLE</span>
            <span>DOCUMENTS</span>
          </div>
        </div>
      </section>

      <section className="workhub-login-panel" aria-labelledby="login-title">
        <div className="workhub-login-card">
          <div className="workhub-mobile-brand"><Brand /></div>
          <p className="workhub-eyebrow">EMPLOYEE SIGN IN</p>
          <h2 id="login-title">WORKHUBにログイン</h2>
          <p className="workhub-muted">CECIL WORKSの社内ポータルへアクセスします。</p>

          {demoConfig.demoEnabled && (
            <div className="workhub-demo-note" role="note">
              <strong>Reference Demo</strong>
              <span>この環境ではデモ用Credentialを利用できます。本番用の認証情報ではありません。</span>
            </div>
          )}

          <form className="workhub-login-form" onSubmit={submit}>
            <label>
              <span>ユーザーID</span>
              <input
                name="userId"
                autoComplete="username"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                required
                maxLength={254}
                disabled={submitting}
              />
            </label>
            <label>
              <span>パスワード</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                maxLength={1024}
                disabled={submitting}
              />
            </label>

            <label className="workhub-remember-row">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={submitting}
              />
              <span>
                ログイン情報を保持する
                <small>この端末にはユーザーIDだけを保存し、Passwordは保存しません。</small>
              </span>
            </label>

            {message && <div className="workhub-login-error" role="alert">{message}</div>}

            <button className="workhub-primary-button" type="submit" disabled={submitting}>
              {submitting ? "確認しています…" : "ログイン"}
            </button>
            {demoConfig.demoEnabled && demoConfig.personas.length > 0 && (
              <button
                className="workhub-secondary-button"
                type="button"
                onClick={() => setPersonaOpen(true)}
                disabled={submitting}
              >
                デモユーザを選ぶ
              </button>
            )}
          </form>
          <p className="workhub-login-footer">CECIL WORKS Inc. · Reference Application</p>
        </div>
      </section>

      {personaOpen && (
        <PersonaDialog
          personas={demoConfig.personas}
          onSelect={choosePersona}
          onClose={() => setPersonaOpen(false)}
        />
      )}
    </main>
  );
}

function WorkhubHome() {
  const auth = useAuth();
  const user = auth.user;
  const reference = user ? HOME_HINTS[user.id] : undefined;

  return (
    <div className="workhub-home-shell">
      <header className="workhub-home-header">
        <Brand />
        <div className="workhub-user-chip">
          <span className="workhub-user-dot" aria-hidden="true" />
          <span>
            <strong>{user?.displayName ?? "CECIL WORKS User"}</strong>
            <small>{reference?.role ?? "Authenticated User"}</small>
          </span>
        </div>
      </header>
      <main className="workhub-home-main">
        <p className="workhub-eyebrow">HOME / MY WORK</p>
        <h1>おはようございます、{user?.displayName ?? "ユーザー"}さん</h1>
        <p className="workhub-home-lead">今日やることを、システム横断でここから始められます。</p>

        <section className="workhub-home-grid" aria-label="WORKHUB Home">
          <article className="workhub-home-card workhub-home-card-primary">
            <span className="workhub-card-label">あなたの優先エリア</span>
            <h2>{reference?.hint ?? "MY WORK"}</h2>
            <p>Persona / Roleに応じたWORKHUB Homeの差分を、この後のVertical Sliceで広げます。</p>
          </article>
          <article className="workhub-home-card">
            <span className="workhub-card-label">QUICK ACTIONS</span>
            <h2>何をしたいですか？</h2>
            <div className="workhub-action-chips">
              <span>休みたい</span>
              <span>出張したい</span>
              <span>経費を精算したい</span>
            </div>
          </article>
          <article className="workhub-home-card">
            <span className="workhub-card-label">REFERENCE STATUS</span>
            <h2>Server-side authentication</h2>
            <p>この画面はPersona選択だけでは開きません。D1のCredential検証とApplication Sessionを通過しています。</p>
          </article>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const auth = useAuth();

  if (auth.status === "loading") {
    return (
      <main className="workhub-loading" aria-live="polite">
        <Brand />
        <span className="workhub-loading-bar" aria-hidden="true" />
        <p>ログイン状態を確認しています…</p>
      </main>
    );
  }

  if (auth.status === "authenticated") return <WorkhubHome />;

  if (auth.status === "error") {
    return (
      <main className="workhub-loading">
        <Brand />
        <h1>ログイン状態を確認できません</h1>
        <p>通信状態を確認してから、もう一度お試しください。</p>
        <button className="workhub-primary-button workhub-retry-button" type="button" onClick={() => void auth.synchronize()}>
          再試行
        </button>
      </main>
    );
  }

  return <LoginScreen />;
}
