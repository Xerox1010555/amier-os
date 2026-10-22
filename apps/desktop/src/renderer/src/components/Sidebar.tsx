import React from "react";
import type { Lang } from "../i18n";
import type { ViewName } from "../store";

interface NavSpec {
  key: ViewName;
}

const NAV: NavSpec[] = [
  { key: "dashboard" },
  { key: "command" },
  { key: "history" },
  { key: "security" },
  { key: "memory" },
  { key: "settings" },
];;

type Translate = (key:
  | "app_title" | "nav_dashboard" | "nav_command" | "nav_history"
  | "nav_security" | "nav_memory" | "nav_settings") => string;

export function Sidebar(props: {
  lang: Lang;
  view: ViewName;
  onNavigate: (v: ViewName) => void;
  t: Translate;
}): React.ReactElement {
  const { t } = props;
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-badge">J</div>
        <span>{t("app_title")}</span>
      </div>
      {NAV.map((item) => (
        <div
          key={item.key}
          className={`nav-item ${props.view === item.key ? "active" : ""}`}
          onClick={() => props.onNavigate(item.key)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && props.onNavigate(item.key)}
        >
          <span className="dot" />
          <span className="nav-label">{t(`nav_${item.key}` as Parameters<Translate>[0])}</span>
          {item.key === "command" && <span className="kbd">⌘K</span>}
        </div>
      ))}
      <div className="sidebar-footer">
        <div>v1.0.0 — local-first</div>
        <div>{props.lang === "ar" ? "الخصوصية أولاً" : "Privacy first"}</div>
      </div>
    </aside>
  );
}
