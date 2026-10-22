import React, { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { Translate } from "../i18n";

export function MemoryView(props: { t: Translate }): React.ReactElement {
  const { t } = props;
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<Array<{ id: string; content: string }>>([]);
  const banner = useStore((s) => s.banner);
  const setBanner = useStore((s) => s.setBanner);

  const add = async () => {
    if (!draft.trim()) return;
    await api.memoriesAdd(draft.trim());
    setItems((prev) => [
      { id: `local-${Date.now()}`, content: draft.trim() },
      ...prev,
    ]);
    setDraft("");
    setBanner({ kind: "ok", message: "saved" });
  };

  return (
    <div className="view">
      <h2 className="view-title">{t("memory_title")}</h2>
      <p className="view-sub">
        local-first memory: what Jarvis should remember between sessions
        {banner?.message ? ` · ${banner.message}` : ""}
      </p>

      <div className="card">
        <textarea
          className="cmdbar"
          style={{ height: 90, resize: "vertical", fontFamily: "inherit" }}
          value={draft}
          placeholder="e.g. نصُب PDF-24 لا يعمل مع ليبر أوفيس… (anything Jarvis should remember)"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={() => void add()}>+ save</button>
          <span className="muted">stored locally (Rust DB in a later milestone), never uploaded.</span>
        </div>
      </div>

      {items.map((item) => (
        <div key={item.id} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>{item.content}</span>
            <button
              className="btn danger"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== item.id))}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      {items.length === 0 && <div className="card muted">— {t("memory_title")}: empty —</div>}
      <div className="muted" style={{ marginTop: 10 }}>
        v1 stores memories in-app; the Rust DB `memories` table takes over in the next milestone (docs/ROADMAP.md §7.2).
      </div>
    </div>
  );
}
