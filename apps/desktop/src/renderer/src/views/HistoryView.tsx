import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Translate } from "../i18n";
import type { TaskDetailView, TaskSummaryView } from "@jarvis/shared";

export function HistoryView(props: { t: Translate }): React.ReactElement {
  const { t } = props;
  const [tasks, setTasks] = useState<TaskSummaryView[]>([]);
  const [selected, setSelected] = useState<TaskDetailView | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await api.listTasks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openTask = async (taskId: string) => {
    const detail = await api.getTask(taskId);
    setSelected(detail);
  };

  return (
    <div className="view">
      <h2 className="view-title">{t("history_title")}</h2>
      <p className="view-sub">
        <button className="btn" onClick={() => void refresh()}>
          ⟳ refresh
        </button>
      </p>

      {selected && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{selected.summary.task_id}</strong>
            <span className={`badge ${selected.summary.status === "completed" ? "low" : "medium"}`}>
              {selected.summary.status}
            </span>
            <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setSelected(null)}>
              ✕
            </button>
          </div>
          <div className="muted" style={{ margin: "8px 0" }}>
            {selected.summary.user_prompt}
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>#{}</th>
                <th>command</th>
                <th>{t("risk")}</th>
                <th>status</th>
                <th>exit</th>
              </tr>
            </thead>
            <tbody>
              {selected.steps.map((step) => (
                <tr key={step.step_id}>
                  <td>{step.idx}</td>
                  <td>
                    <span className="mono" style={{ padding: "4px 8px" }}>{step.command}</span>
                  </td>
                  <td>
                    <span className={`badge ${step.risk_level}`}>{step.risk_level}</span>
                    <span className="muted" style={{ marginLeft: 6 }}>{step.risk_source}</span>
                  </td>
                  <td>{step.status}</td>
                  <td className="muted">{step.exit_code ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn danger" onClick={() => void api.cancelTask(selected.summary.task_id)}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card"><span className="sparkle">loading…</span></div>
      ) : tasks.length === 0 ? (
        <div className="card muted">— empty —</div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>task</th>
                <th>status</th>
                <th>steps</th>
                <th>created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.task_id}>
                  <td className="mono" style={{ padding: "6px 10px" }}>{task.task_id.slice(0, 8)}</td>
                  <td>
                    <span className={`badge ${task.status === "completed" ? "low" : task.status === "failed" ? "high" : "medium"}`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="muted">
                    {task.steps_done}/{task.steps_total}
                    {task.steps_denied > 0 ? ` · ${t("blocked_label")}: ${task.steps_denied}` : ""}
                  </td>
                  <td className="muted">{task.created_at.slice(0, 19).replace("T", " ")}</td>
                  <td>
                    <button className="btn" onClick={() => void openTask(task.task_id)}>
                      ↗
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
