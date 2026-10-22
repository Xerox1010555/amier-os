import React, { useEffect, useMemo, useState } from "react";
import type { EngineEvent } from "@jarvis/shared";
import type { ViewName } from "./store";
import { api, type AskResult, type GatedStepLite } from "./api";
import { useStore } from "./store";
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
  const t = useMemo(() => makeT(lang), [lang]);

  const { setStatus, setBanner, ingestEvent, pending, setPending } = useStore();

  useEffect(() => {
    void api.getSystemStatus().then((s) => setStatus(s)).catch(() => setStatus(null));
    const unsubscribe = api.onEngine((raw) => {
      const ev = raw as EngineEvent;
      ingestEvent(ev);
      if (ev.event_type === "task_done") void api.listTasks();
    });
    void api.aiHealth().then((h) => {
      const online = h && Object.prototype.hasOwnProperty.call(h, "status");
      if (!online) {
        setBanner({ kind: "warn", message: t("service_offline") });
      }
    });
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

  return (
    <div className="shell" dir={lang === "ar" ? "rtl" : "ltr"}>
      <Sidebar lang={lang} view={view} onNavigate={setView} t={t} />
      <main className="main">
        {view === "dashboard" && <Dashboard t={t} lang={lang} onNavigate={(v) => setView(v)} />}
        {view === "command" && <CommandView t={t} lang={lang} onLang={setLang} setView={setView} />}
        {view === "history" && <HistoryView t={t} />}
        {view === "security" && <SecurityView t={t} />}
        {view === "memory" && <MemoryView t={t} />}
        {view === "settings" && <SettingsView t={t} />}
      </main>
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
