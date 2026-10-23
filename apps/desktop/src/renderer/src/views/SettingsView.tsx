import React, { useEffect, useState } from "react";
import { api } from "../api";
import type { Translate } from "../i18n";

export function SettingsView(props: { t: Translate }): React.ReactElement {
  const { t } = props;
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [secret, setSecret] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    void api.settingsGet().then(setSettings);
    void api.aiHealth().then(setHealth);
  }, []);

  const saveSecret = async () => {
    if (!secret.trim()) return;
    await api.setSecret(secret.trim());
    setSecret("");
    setSavedMsg("shared secret saved to OS keychain ✔");
  };

  return (
    <div className="view">
      <h2 className="view-title">{t("settings_title")}</h2>
      <p className="view-sub">local-first configuration — services read .env, secrets live in the OS keychain</p>

      <div className="card">
        <strong>AI orchestrator</strong>
        <table className="table" style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <td className="muted">provider (service)</td>
              <td>{String(health?.provider ?? settings?.provider ?? "?")}</td>
            </tr>
            <tr>
              <td className="muted">model</td>
              <td>{String(health?.model ?? "?")}</td>
            </tr>
            <tr>
              <td className="muted">service</td>
              <td>{String(settings?.api_base ?? "http://127.0.0.1:8000")}</td>
            </tr>
            <tr>
              <td className="muted">health</td>
              <td>
                {health?.status === "online" ? (
                  <span className="badge low">online · v{String(health?.version ?? "?")}</span>
                ) : (
                  <span className="badge high">{t("service_offline")}</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="muted">auth required</td>
              <td>{String(health?.auth_required ?? "?" )}</td>
            </tr>
            <tr>
              <td className="muted">shared secret</td>
              <td>{settings?.secretSet ? <span className="badge low">set ✔</span> : <span className="badge medium">not set</span>}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <strong>Shared secret (X-Jarvis-Secret)</strong>
        <div className="muted" style={{ margin: "6px 0" }}>
          paste the JARVIS_SHARED_SECRET from services/ai-orchestrator/.env — stored via keytar (fallback: AES-GCM local file).
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="password"
            className="cmdbar"
            style={{ padding: "8px 12px", fontSize: 13, maxWidth: 340 }}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void saveSecret()}
            placeholder="hex64…"
          />
          <button className="btn primary" onClick={() => void saveSecret()}>save</button>
        </div>
        {savedMsg && <div className="banner ok" style={{ marginTop: 10 }}>{savedMsg}</div>}
      </div>

      <div className="card">
        <strong>About</strong>
        <div className="muted" style={{ marginTop: 6 }}>
          Amier OS v1.0.0 — Electron 31 + React 18 + Rust (napi) core + FastAPI orchestrator.
          <br />
          The renderer never receives raw execution authority: every command crosses the
          deterministic Rust rules engine and the hash-chained audit log.
        </div>
      </div>
    </div>
  );
}
