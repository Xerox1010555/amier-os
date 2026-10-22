import React, { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { Lang, Translate } from "../i18n";
import type { ViewName } from "../store";
import type { TaskSummaryView } from "@jarvis/shared";

export function Dashboard(props: {
  t: Translate;
  lang: Lang;
  onNavigate: (v: ViewName) => void;
}): React.ReactElement {
  const { t, lang } = props;
  const status = useStore((s) => s.status);
  const engineOnline = useStore((s) => s.engineOnline);
  const liveTasks = useStore((s) => s.liveTasks);
  const [tasks, setTasks] = useState<TaskSummaryView[]>([]);

  useEffect(() => {
    void api.listTasks().then(setTasks).catch(() => setTasks([]));
  }, [Object.keys(liveTasks).length]);

  const done = tasks.filter((x) => x.status === "completed").length;
  const denied = tasks.reduce((acc, x) => acc + x.steps_denied, 0);
  const active = Object.keys(liveTasks).filter(
    (id) => liveTasks[id]?.status === "running",
  ).length;

  const labels =
    lang === "ar"
      ? { tasks: "المهام", done: "مكتملة", blocked: "محظورة", active: "نشطة", recent: "أحدث المهام", engine: "المحرك", rules: "قواعد الأمن" }
      : { tasks: "Tasks", done: "Completed", blocked: "Blocked", active: "Active", recent: "Recent tasks", engine: "Engine", rules: "Security rules" };

  return (
    <div className="view">
      <h2 className="view-title">{t("dashboard_title")}</h2>
      <p className="view-sub">
        {engineOnline ? "◉ " + labels.engine + ": online" : "◌ " + t("engine_offline")}
        {status ? ` · ${status.rules_count} ${labels.rules}` : ""}
      </p>

      <div className="grid-stats">
        <div className="stat">
          <div className="num">{tasks.length}</div>
          <div className="lbl">{labels.tasks}</div>
        </div>
        <div className="stat">
          <div className="num" style={{ color: "var(--ok)" }}>{done}</div>
          <div className="lbl">{labels.done}</div>
        </div>
        <div className="stat">
          <div className="num" style={{ color: "var(--danger)" }}>{denied}</div>
          <div className="lbl">{labels.blocked}</div>
        </div>
        <div className="stat">
          <div className="num" style={{ color: "var(--warn)" }}>{active}</div>
          <div className="lbl">{labels.active}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{labels.recent}</strong>
          <button className="btn primary" onClick={() => props.onNavigate("command")}>
            ⌘ {t("nav_command")}
          </button>
        </div>
        {tasks.length === 0 ? (
          <div className="muted" style={{ marginTop: 10 }}>
            {lang === "ar" ? "لا مهام بعد — ابدأ من الأوامر." : "No tasks yet — start from Command."}
          </div>
        ) : (
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>{t("tasks")}</th>
                <th>{t("risk")}</th>
                <th>{labels.done}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.slice(0, 6).map((task) => (
                <tr key={task.task_id}>
                  <td>
                    <span className="mono" style={{ padding: "4px 8px" }}>
                      {task.user_prompt.slice(0, 70) || task.task_id.slice(0, 8)}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${task.status === "completed" ? "low" : task.status === "failed" ? "high" : "medium"}`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="muted">{task.steps_done}/{task.steps_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
