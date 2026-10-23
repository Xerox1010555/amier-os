import React, { useEffect, useMemo, useState } from "react";
import type { EngineEvent } from "@jarvis/shared";
import { api, type AskResult, type GatedStepLite } from "./api";
import { useStore, type ViewName } from "./store";
import { makeT, type Lang } from "./i18n";
import { Sidebar } from "./components/Sidebar";
import { CommandView } from "./components/CommandView";
import { Dashboard } from "./views/Dashboard";
import { HistoryView } from "./views/HistoryView";
import { SecurityView } from "./views/SecurityView";
import { MemoryView } from "./views/MemoryView";
import { SettingsView } from "./views/SettingsView";
import { ConfirmDialog } from "./components/ConfirmDialog";

const initialLang: Lang = (navigator.language || "en").toLowerCase().startsWith("ar") ? "ar" : "en";

export function App(): React.ReactElement {
  const [view, setView] = useState<ViewName>("dashboard");
  const [lang, setLang] = useState<Lang>(initialLang);
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const t = useMemo(() => makeT(lang), [lang]);

  const { setStatus, setBanner, ingestEvent, pending, setPending, engineOnline } = useStore();

  useEffect(() => {
    void api.getSystemStatus().then((s) => setStatus(s)).catch(() => setStatus(null));
    const unsubscribe = api.onEngine((raw) => {
      const ev = raw as EngineEvent;
      ingestEvent(ev);
      if (ev.event_type === "task_done") void api.listTasks();
    });
    void api
      .aiHealth()
      .then((h) => {
        const online = Boolean(h && Object.prototype.hasOwnProperty.call(h, "status"));
        setServiceOnline(online);
        if (!online) setBanner({ kind: "warn", message: t("service_offline") });
      })
      .catch(() => setServiceOnline(false));
    // Hot-reload friendly cleanup (no listener leaks by construction).
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setView("command");
        requestAnimationFrame(() => document.getElementById("jarvis-cmdbar")?.focus());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const statusDot = (up: boolean | null, down: "bad" | "warn" = "bad"): "ok" | "bad" | "warn" =>
    up === null ? "warn" : up ? "ok" : down;

  return (
    <div className="app" dir={lang === "ar" ? "rtl" : "ltr"}>
      {/* ── Aurora depth stage ── */}
      <div className="aurora" aria-hidden="true">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        <div className="grid-overlay" />
      </div>

      {/* ── Custom window chrome ── */}
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-badge">J</div>
          <span>
            AMIER OS
            <small>v1.0.0</small>
          </span>
        </div>
        <div className="topbar-pills">
          <span className="pill">
            <span className={`dot ${engineOnline ? "ok" : "bad"}`} />
            {engineOnline ? (lang === "ar" ? "المحرك متصل" : "ENGINE ONLINE") : t("engine_offline")}
          </span>
          <span className="pill">
            <span className={`dot ${statusDot(serviceOnline, "warn")}`} />
            {serviceOnline ? (lang === "ar" ? "الخدمة متصلة" : "AI SERVICE") : t("service_offline")}
          </span>
        </div>
        <div className="win-controls">
          <button
            className="win-btn"
            title={lang === "ar" ? "تصغير" : "Minimize"}
            onClick={() => window.aiOS?.win?.min()}
          >
            ─
          </button>
          <button
            className="win-btn"
            title={lang === "ar" ? "تكبير / استعادة" : "Maximize / restore"}
            onClick={() => window.aiOS?.win?.max()}
          >
            ▢
          </button>
          <button
            className="win-btn close"
            title={lang === "ar" ? "إغلاق" : "Close"}
            onClick={() => window.aiOS?.win?.close()}
          >
            ✕
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="shell">
        <Sidebar lang={lang} view={view} onNavigate={setView} t={t} />
        <main className="main">
          {view === "dashboard" && <Dashboard t={t} lang={lang} onNavigate={setView} />}
          {view === "command" && <CommandView t={t} lang={lang} onLang={setLang} setView={setView} />}
          {view === "history" && <HistoryView t={t} />}
          {view === "security" && <SecurityView t={t} />}
          {view === "memory" && <MemoryView t={t} />}
          {view === "settings" && <SettingsView t={t} />}
        </main>
      </div>

      {pending && (
        <ConfirmDialog
          pending={pending}
          lang={lang}
          onDecide={(approved) => {
            void api.confirmStep(pending.stepId, approved);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}

export type { AskResult, GatedStepLite };
