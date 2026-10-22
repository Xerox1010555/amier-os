import React from "react";
import type { PendingConfirmation } from "../store";
import type { Lang } from "../i18n";

type Translate = (key: "awaiting_confirmation" | "deny" | "approve" | "cancel" | "risk") => string;

export function ConfirmDialog(props: {
  pending: PendingConfirmation;
  lang: Lang;
  onDecide: (approved: boolean) => void;
}): React.ReactElement {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true">
        <h3 style={{ marginTop: 0 }}>🛡 {`Confirm before running`}</h3>
        <p style={{ color: "var(--text-dim)" }}>{props.pending.taskId?.slice(0, 8)}… · {props.pending.riskLevel}</p>
        <div className="mono" style={{ margin: "12px 0" }}>{props.pending.command}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn danger" onClick={() => props.onDecide(false)}>
            ⛔ {props.lang === "ar" ? "رفض" : "Deny"}
          </button>
          <button className="btn success" onClick={() => props.onDecide(true)}>
            ✔ {props.lang === "ar" ? "موافقة" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

export type { Translate };
