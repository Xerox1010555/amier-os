import React, { useEffect, useState } from "react";
import { api, ApiError, getServer, getSecret, setSecret, setServer, type Health, type Plan } from "./api";

type Tab = "plan" | "chat" | "settings";
type Lang = "en" | "ar";

const initialLang = (navigator.language || "en").toLowerCase().startsWith("ar") ? "ar" : "en";

export function App(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("plan");
  const [lang, setLang] = useState<Lang>(initialLang as Lang);
  const [health, setHealth] = useState<Health | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "warn" | "error"; message: string } | null>(null);

  const probe = () => {
    setHealth(null);
    api
      .health()
      .then(setHealth)
      .catch((e: unknown) => {
        setHealth(null);
        if (e instanceof ApiError) setBanner({ kind: "error", message: `${e.code}: ${e.message}` });
        else setBanner({ kind: "warn", message: lang === "ar" ? "الخدمة لا تصل — تحقّق من الشبكة/السيرفر" : "Service unreachable — check server/network" });
      });
  };

  useEffect(probe, [lang]);

  const online = health?.status === "online";

  return (
    <div className="app" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="aurora" aria-hidden="true">
        <div className="orb orb-1" />
        <div className="orb orb-3" />
        <div className="grid-overlay" />
      </div>

      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-badge">A</div>
          <span>
            AMIER OS
            <small>{lang === "ar" ? "الرفيق" : "companion"}</small>
          </span>
        </div>
        <span className={`pill ${online ? "" : "pill-bad"}`}>
          <span className={`dot ${online ? "ok" : "bad"}`} />
          {online ? `${health?.provider} · ${health?.version}` : lang === "ar" ? "غير متصل" : "offline"}
        </span>
        <button className="pill" onClick={() => setLang(lang === "en" ? "ar" : "en")}>
          {lang === "en" ? "ع" : "EN"}
        </button>
      </header>

      <main className="content">
        {banner && (
          <div className={`banner ${banner.kind}`}>
            <span className="muted">{banner.message}</span>
          </div>
        )}
        {tab === "plan" && <PlanView lang={lang} onNeedSettings={() => setTab("settings")} />}
        {tab === "chat" && <ChatView lang={lang} />}
        {tab === "settings" && <SettingsView lang={lang} onSaved={probe} />}
      </main>

      <nav className="tabbar">
        <button className={tab === "plan" ? "tab active" : "tab"} onClick={() => setTab("plan")}>
          ⌘ <span>{lang === "ar" ? "مخطط" : "Plan"}</span>
        </button>
        <button className={tab === "chat" ? "tab active" : "tab"} onClick={() => setTab("chat")}>
          ✦ <span>{lang === "ar" ? "دردشة" : "Chat"}</span>
        </button>
        <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>
          ⚙ <span>{lang === "ar" ? "إعدادات" : "Settings"}</span>
        </button>
      </nav>
    </div>
  );
}

function PlanView(props: { lang: Lang; onNeedSettings: () => void }): React.ReactElement {
  const lang = props.lang;
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!prompt.trim()) return;
    setThinking(true);
    setError(null);
    setPlan(null);
    try {
      setPlan(await api.plan(prompt.trim()));
    } catch (e) {
      setError(e instanceof ApiError && e.code === "E_AUTH" ? (lang === "ar" ? "أدخل السرّ في الإعدادات" : "Set the shared secret in Settings") : String(e instanceof Error ? e.message : e));
    } finally {
      setThinking(false);
    }
  };

  const riskEmoji: Record<string, string> = { low: "🟢", medium: "🟡", high: "🔴", deny: "⛔" };

  return (
    <div className="view">
      <h2 className="view-title">{lang === "ar" ? "مخطط جديد" : "New plan"}</h2>
      <p className="view-sub">
        {lang === "ar"
          ? "يعرض المخطط كما صنّفه المزوّد — التوقيع والأمن يُحسم على الحاسوب (النواة) قبل أي تنفيذ."
          : "Plans render the provider's advisory view — the deterministic gate lives on the desktop kernel."}
      </p>

      <div className="cmdbar-wrap">
        <span className="cmdbar-emoji">✨</span>
        <textarea
          className="cmdbar textarea"
          value={prompt}
          placeholder={lang === "ar" ? "اطلب شيئاً… / list downloads folder" : "Ask for something…"}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={() => void ask()} disabled={thinking || !prompt.trim()}>
          {thinking ? <span className="sparkle">{lang === "ar" ? "يفكّر…" : "planning…"}</span> : lang === "ar" ? "خطط" : "Plan it"}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {plan && (
        <div className="card">
          <div className="row">
            <strong>{plan.steps.length} steps</strong>
            <span className="muted">{plan.provider}</span>
          </div>
          {plan.steps.map((s, i) => (
            <div key={i} className={`card plan-step risk-${s.llm_risk_level}`} style={{ margin: "10px 0 0" }}>
              <div className="row">
                <span className={`badge ${s.llm_risk_level}`}>
                  {riskEmoji[s.llm_risk_level] ?? "·"} {s.llm_risk_level}
                </span>
                <span className="muted">{s.description}</span>
              </div>
              <div className="mono" style={{ marginTop: 8 }}>{s.command}</div>
            </div>
          ))}
          <div className="muted" style={{ marginTop: 10 }}>
            {lang === "ar"
              ? "التنفيذ يجرى على الحاسوب المربوط بلا جدل — الهاتف يعرض ويُقيّم فقط."
              : "Execution stays on the paired desktop — the phone plans and reviews only."}
          </div>
        </div>
      )}
    </div>
  );
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

function ChatView(props: { lang: Lang }): React.ReactElement {
  const lang = props.lang;
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
    setDraft("");
    setMessages((prev) => [...prev, { role: "user", content: prompt }, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      await api.chat(
        prompt,
        history,
        (delta) =>
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last) {
              next[next.length - 1] = { role: last.role, content: last.content + delta };
            }
            return next;
          }),
      );
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last) {
          next[next.length - 1] = {
            role: last.role,
            content: last.content || `⚠ ${e instanceof ApiError ? e.message : String(e)}`,
          };
        }
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view chat-view">
      <h2 className="view-title">{lang === "ar" ? "دردشة" : "Chat"}</h2>
      <p className="view-sub">{lang === "ar" ? "بث مباشر من المزوّد" : "streamed live from the provider"}</p>
      <div className="card chat-list" ref={listRef}>
        {messages.length === 0 && <div className="muted">{lang === "ar" ? "ابدأ بالسلااام…" : "Say something…"}</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.role === "assistant" && m.content === "" ? <span className="sparkle">…</span> : m.content}
          </div>
        ))}
      </div>
      <div className="row chat-send">
        <input
          className="cmdbar"
          style={{ padding: "12px 16px" }}
          value={draft}
          placeholder={lang === "ar" ? "اكتب…" : "type…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send()}
        />
        <button className="btn primary" onClick={() => void send()} disabled={busy || !draft.trim()}>
          ➤
        </button>
      </div>
    </div>
  );
}

function SettingsView(props: { lang: Lang; onSaved: () => void }): React.ReactElement {
  const lang = props.lang;
  const [server, setServerState] = useState(getServer());
  const [secret, setSecretState] = useState(getSecret());
  const [saved, setSaved] = useState(false);

  const save = () => {
    setServer(server.trim());
    setSecret(secret.trim());
    setSaved(true);
    props.onSaved();
  };

  return (
    <div className="view">
      <h2 className="view-title">{lang === "ar" ? "الإعدادات" : "Settings"}</h2>
      <p className="view-sub">
        {lang === "ar"
          ? "على الحاسوب: شغّل الخدمة على 0.0.0.0 وافتح CORS، وأدخل هنا السرّ نفسه."
          : "On the desktop service: bind 0.0.0.0, open CORS for the app, use the same shared secret here."}
      </p>

      <div className="card">
        <label className="muted" style={{ display: "block", marginBottom: 6 }}>
          {lang === "ar" ? "عنوان الخدمة" : "Server URL"}
        </label>
        <input className="cmdbar input" style={{ padding: "12px 14px" }} value={server} onChange={(e) => setServerState(e.target.value)} />
        <div className="muted" style={{ marginTop: 6 }}>e.g. http://192.168.1.10:8000 · emulator: http://10.0.2.2:8000</div>

        <label className="muted" style={{ display: "block", margin: "14px 0 6px" }}>
          {lang === "ar" ? "السرّ المشترك (X-Jarvis-Secret)" : "Shared secret (X-Jarvis-Secret)"}
        </label>
        <input
          className="cmdbar input"
          type="password"
          style={{ padding: "12px 14px" }}
          value={secret}
          placeholder="hex64…"
          onChange={(e) => setSecretState(e.target.value)}
        />

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={save}>
            {lang === "ar" ? "حفظ" : "Save"}
          </button>
          {saved && <span className="badge low">{lang === "ar" ? "محفوظ ✔" : "saved ✔"}</span>}
        </div>
      </div>

      <div className="card">
        <strong>{lang === "ar" ? "عن التطبيق" : "About"}</strong>
        <div className="muted" style={{ marginTop: 6 }}>
          Amier OS v1.0.0 — companion (React + Capacitor). هذا التطبيق لا ينفّذ أوامر النظام: العقد الأمني ينفّذه نواة الحاسوب.
        </div>
      </div>
    </div>
  );
}
