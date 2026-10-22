import { create } from "zustand";
import type { EngineEvent, ExecutionPlanLLM, StatusView } from "@jarvis/shared";
import type { GatedStepLite } from "./api";

export interface PendingConfirmation {
  taskId: string | null;
  stepId: string;
  command: string;
  riskLevel: string;
}

export type EngineBanner =
  | { kind: "ok"; message: string }
  | { kind: "warn"; message: string }
  | { kind: "error"; message: string };

/** All top-level views (single source of truth for navigation). */
export type ViewName =
  | "dashboard"
  | "command"
  | "history"
  | "security"
  | "memory"
  | "settings";

export interface LiveTask {
  taskId: string;
  stream: string[];
  status: "running" | "done" | "failed" | "cancelled";
  lastUpdate: number;
}

interface StoreState {
  status: StatusView | null;
  banner: EngineBanner | null;
  plan: ExecutionPlanLLM | null;
  steps: GatedStepLite[];
  needsConfirmation: boolean;
  running: boolean;
  pending: PendingConfirmation | null;
  liveTasks: Record<string, LiveTask>;
  engineOnline: boolean;
  health: Record<string, unknown> | null;

  setStatus: (s: StatusView | null) => void;
  setBanner: (b: EngineBanner | null) => void;
  setPlan: (plan: ExecutionPlanLLM | null, steps: GatedStepLite[], needs: boolean) => void;
  setRunning: (running: boolean) => void;
  setPending: (p: PendingConfirmation | null) => void;
  setEngineOnline: (online: boolean) => void;
  setHealth: (h: Record<string, unknown> | null) => void;
  ingestEvent: (ev: EngineEvent) => void;
}

export const useStore = create<StoreState>((set) => ({
  status: null,
  banner: null,
  plan: null,
  steps: [],
  needsConfirmation: false,
  running: false,
  pending: null,
  liveTasks: {},
  engineOnline: false,
  health: null,

  setStatus: (status) => {
    set({ status, engineOnline: Boolean(status?.engine_ready) });
  },
  setBanner: (banner) => set({ banner }),
  setPlan: (plan, steps, needs) =>
    set({ plan, steps, needsConfirmation: needs, running: false, pending: null }),
  setRunning: (running) => set({ running }),
  setPending: (pending) => set({ pending }),
  setEngineOnline: (engineOnline) => set({ engineOnline }),
  setHealth: (health) => set({ health }),
  ingestEvent: (ev) => {
    set((state) => {
      if (!ev.task_id) return state;
      const t = state.liveTasks[ev.task_id] ?? {
        taskId: ev.task_id,
        stream: [],
        status: "running" as const,
        lastUpdate: Date.now(),
      };
      const next = { ...t, lastUpdate: Date.now() };
      const stream = [...t.stream];
      let status = next.status;
      let pending = state.pending;
      switch (ev.event_type) {
        case "step_started":
          stream.push(`▶ step ${(ev.payload as { idx?: number }).idx ?? ""}: ${(ev.payload as { command?: string }).command ?? ""}`);
          break;
        case "step_done":
          stream.push((ev.payload as { stdout_preview?: string; exit_code?: number }).exit_code === 0
            ? `✔ ok: ${(ev.payload as { stdout_preview?: string }).stdout_preview ?? ""}`
            : `✘ exit ${(ev.payload as { exit_code?: number }).exit_code}: ${(ev.payload as { stderr_preview?: string }).stderr_preview ?? ""}`);
          break;
        case "step_denied":
          stream.push(`⛔ denied: ${(ev.payload as { reason?: string }).reason ?? "user denied"}`);
          break;
        case "security_alert":
          stream.push(`🚨 SECURITY: ${(ev.payload as { command?: string }).command ?? ""}`);
          break;
        case "awaiting_confirmation":
          pending = {
            taskId: ev.task_id,
            stepId: ev.step_id ?? "",
            command: String((ev.payload as { command?: string }).command ?? ""),
            riskLevel: String((ev.payload as { risk_level?: string }).risk_level ?? ""),
          };
          break;
        case "task_done": {
          const s = String((ev.payload as { status?: string }).status ?? "completed");
          status = s === "completed" ? "done" : s === "failed" ? "failed" : "cancelled";
          break;
        }
        default:
          break;
      }
      return {
        liveTasks: { ...state.liveTasks, [ev.task_id]: { ...next, stream, status } },
        pending,
      };
    });
  },
}));
