import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Translate } from "../i18n";
import type { AuditEntryView, ChainStatusView, PermissionView } from "@jarvis/shared";

const AUDIT_KIND_BADGE: Record<string, string> = {
  task_created: "neutral",
  task_done: "low",
  step_done: "low",
  step_denied: "high",
  awaiting_confirmation: "medium",
  permission_changed: "medium",
  genesis: "neutral",
};

export function SecurityView(props: { t: Translate }): React.ReactElement {
  const { t } = props;
  const [chain, setChain] = useState<ChainStatusView | null>(null);
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [permissions, setPermissions] = useState<PermissionView[]>([]);
  const [newRule, setNewRule] = useState("");
  const [newResult, setNewResult] = useState<"allow" | "require_confirm" | "deny">("require_confirm");

  const refresh = useCallback(async () => {
    const [chainRes, trail, perms] = await Promise.all([
      api.auditVerify(),
      api.auditExplore(0, 100),
      api.listPermissions(),
    ]);
    setChain(chainRes);
    setEntries(trail);
    setPermissions(perms);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addPermission = async () => {
    if (!newRule.trim()) return;
    await api.upsertPermission(newRule.trim(), newResult);
    setNewRule("");
    await refresh();
  };

  return (
    <div className="view">
      <h2 className="view-title">{t("security_title")}</h2>
      <p className="view-sub">deterministic rules · hash-chained audit · least privilege</p>

      <div className={`banner ${chain ? (chain.intact ? "ok" : "error") : "warn"}`}>
        {chain === null
          ? "verifying…"
          : chain.intact
            ? `${t("audit_chain_ok")} — ${chain.entries} entries`
            : `${t("audit_chain_broken")} @ seq ${chain.broken_at}`}
      </div>

      <div className="card">
        <strong>Permissions overlay</strong>
        <div className="muted" style={{ margin: "6px 0" }}>
          Optional allow/confirm/deny overrides layered on top of the deterministic ruleset.
          The rules engine always runs first: an override can never make a "deny" rule execute.
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="cmdbar"
            style={{ padding: "8px 12px", fontSize: 13, maxWidth: 320 }}
            value={newRule}
            placeholder="rule regex or command prefix"
            onChange={(e) => setNewRule(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addPermission()}
          />
          <select
            value={newResult}
            onChange={(e) => setNewResult(e.target.value as typeof newResult)}
            style={{ padding: "8px 10px", borderRadius: 10, background: "var(--bg-elev-2)", color: "var(--text)", border: "1px solid var(--border)" }}
          >
            <option value="allow">allow</option>
            <option value="require_confirm">require_confirm</option>
            <option value="deny">deny</option>
          </select>
          <button className="btn primary" onClick={() => void addPermission()}>+ add</button>
        </div>
        {permissions.length > 0 && (
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>rule</th>
                <th>result</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {permissions.map((perm) => (
                <tr key={perm.id}>
                  <td className="mono" style={{ padding: "6px 10px" }}>{perm.rule}</td>
                  <td><span className={`badge ${perm.result === "deny" ? "high" : perm.result === "allow" ? "low" : "medium"}`}>{perm.result}</span></td>
                  <td>
                    <button
                      className="btn danger"
                      onClick={() => void api.deletePermission(perm.rule).then(refresh)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <strong>Audit log</strong>
        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>seq</th>
              <th>ts</th>
              <th>kind</th>
              <th>hash</th>
            </tr>
          </thead>
          <tbody>
            {entries
              .slice()
              .reverse()
              .slice(0, 25)
              .map((entry) => (
                <tr key={entry.seq}>
                  <td className="muted">{entry.seq}</td>
                  <td className="muted">{entry.ts.slice(11, 19)}</td>
                  <td>
                    <span className={`badge ${AUDIT_KIND_BADGE[entry.kind] ?? "neutral"}`}>{entry.kind}</span>
                  </td>
                  <td className="mono" style={{ padding: "4px 8px" }}>{entry.hash.slice(0, 12)}…</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
