import React, { useEffect, useRef, useState } from "react";
import type { RiskLevel } from "@jarvis/shared";
import { api, type GatedStepLite } from "../api";
import { useStore, type ViewName } from "../store";
import type { Lang } from "../i18n";

const RISK_EMOJI: Record<string, string> = {
  low: "🟢",
  medium: "🟡",
  high: "🔴",
  deny: "⛔",
};

type Translate = (key:
  | "app_title" | "nav_dashboard" | "nav_command" | "nav_history"
  | "nav_security" | "nav_memory" | "nav_settings"
  | "commandbar_placeholder" | "run" | "deny" | "approve" | "cancel"
  | "risk" | "step" | "awaiting_confirmation" | "engine_offline"
  | "service_offline" | "tasks") => string;

interface CommandViewProps {
  t: Translate;
  lang: Lang;
  onLang: (l: Lang) => void;
  setView?: (v: ViewName) => void;
}

export function CommandView(props: CommandViewProps): React.ReactElement {
  const { t, lang, onLang } = props;
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(false);
  const plan = useStore((s) => s.plan);
  const steps = useStore((s) => s.steps);
  const needs = useStore((s) => s.needsConfirmation);
  const engineOnline = useStore((s) => s.engineOnline);
  const setPlan = useStore((s) => s.setPlan);
  const setBanner = useStore((s) => s.setBanner);
  const setRunning = useStore((s) => s.setRunning);
  const liveTaskIds = Object.keys(useStore((s) => s.liveTasks));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function ask() {
    if (!prompt.trim() || thinking) return;
    setThinking(true);
    setPlan(null, [], false);
    try {
      const result: Awaited<ReturnType<typeof api.ask>> = await api.ask(prompt.trim());
      if (result.problem) {
        setBanner({ kind: "error", message: `AI service: ${result.problem.code ?? "error"} (${result.status ?? ""})` });
      } else if (result.__jarvis_error || result.error) {
        setBanner({ kind: "error", message: result.error ?? "engine error" });
      } else if (result.plan && result.steps) {
        setPlan(result.plan, result.steps, Boolean(result.needs_confirmation));
        if (!engineOnline) {
          setBanner({ kind: "warn", message: t("engine_offline") });
        }
      }
    } catch (err) {
      setBanner({ kind: "error", message: String(err) });
    } finally {
      setThinking(false);
    }
  }

  async function run() {
    if (!plan) return;
    setRunning(true);
    const res = await api.runPlan(plan.task_id);
    if (!res.ok) {
      setBanner({ kind: "error", message: res.error ?? "failed to start" });
      setRunning(false);
      return;
    }
    setBanner({ kind: "ok", message: `${t("tasks")} → ${res.detail ?? "started"}` });
  }

  return (
    <div className="view" >
      <h2 className="view-title">{t("nav_command")}</h2>
      <p className="view-sub">{t("commandbar_placeholder")}</p>

      <div className="cmdbar-wrap">
        <span className="cmdbar-emoji">✨</span>
        <input
          id="jarvis-cmdbar"
          ref={inputRef}
          className="cmdbar"
          value={prompt}
          placeholder={props.t("commandbar_placeholder")}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void ask()}
        />
      </div>

      <div className="row" style={{ display: "flex", gap: 10, margin: "14px 0" }}>
        <button className="btn primary" onClick={() => void ask()} disabled={thinking}>
          {thinking ? <span className="sparkle">planning…</span> : <>Plan it</>}
        </button>
        {lang === "en" ? (
          <button className="btn" onClick={() => onLang("ar")}>العربية</button>
        ) : (
          <button className="btn" onClick={() => onLang("en")}>English</button>
        )}
      </div>

      {thinking && <div className="card"><div className="sparkle">{prompt.slice(0, 60) || "…"}…</div></div>}

      {steps.length > 0 && (
        <div>
          <div style={{ color: "var(--text-dim)", marginBottom: 8 }}>
            {t("risk")} — {plan?.provider} / {plan?.model} · needs_confirmation: {String(needs)}
          </div>
          {steps.map((s: GatedStepLite, i: number) => (
            <div key={i} className={`card plan-step risk-${s.risk}`}>
              <div className="row">
                <span className={`badge ${s.risk}`}>
                  {RISK_EMOJI[s.risk] ?? "●"} {s.risk}
                </span>
                <span className="muted">
                  {t("step")} {i + 1} · {s.risk_source}
                  {s.matched_rule ? ` · rule: ${s.matched_rule}` : ""}
                </span>
              </div>
              <div style={{ margin: "8px 0 6px", fontWeight: 600 }}>{s.description}</div>
              <div className="mono">{s.command}</div>
              {s.rationale && <div className="muted" style={{ marginTop: 6 }}>{s.rationale}</div>}
            </div>
          ))}
          <button className="btn primary" onClick={() => void run()} disabled={!engineOnline || !plan}>
            ▶ {t("run")}
          </button>
        </div>
      )}

      {liveTaskIds.length > 0 && (
        <div style={{ marginTop: 18 }}>
          {liveTaskIds.map((taskId) => (
            <LiveStream key={taskId} taskId={taskId} />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveStream(props: { taskId: string }): React.ReactElement | null {
  const task = useStore((s) => s.liveTasks[props.taskId]);
  const t = useStore((s) => s.pending);
  void t; // reactive ref only
  if (!task) return null;
  return (
    <div className="card">
      <div className="row">
        <strong>{props.taskId.slice(0, 8)}…</strong>
        <span className={`badge ${task.status === "done" ? "low" : task.status === "failed" ? "high" : "medium"}`}>
          {task.status}
        </span>
        <button className="btn danger" style={{ marginLeft: "auto" }} onClick={() => void api.cancelTask(props.taskId)}>
          {useStore.getState().pending ? "…" : "Stop"}
        </button>
      </div>
      <pre className="mono" style={{ maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap" }}>
        {task.stream.slice(-40).join("\n") || "…"}
      </pre>
    </div>
  );
}
