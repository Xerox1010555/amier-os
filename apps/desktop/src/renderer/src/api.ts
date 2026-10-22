/**
 * Type-safe facade over window.aiOS. The renderer is untrusted; all calls
 * funnel through the preload whitelist (Zod-like runtime guards in main).
 */
import type {
  AuditEntryView,
  ChainStatusView,
  EngineEvent,
  ExecutionPlanLLM,
  PermissionView,
  StatusView,
  TaskDetailView,
  TaskSummaryView,
} from "@jarvis/shared";

export interface GatedStepLite {
  description: string;
  command: string;
  risk: string;
  matched_rule: string | null;
  risk_source: string;
  requires_confirmation: boolean;
  rationale: string | null;
}

export interface AskResult {
  plan?: ExecutionPlanLLM;
  steps?: GatedStepLite[];
  needs_confirmation?: boolean;
  problem?: { code?: string };
  status?: number;
  __jarvis_error?: boolean;
  error?: string;
}

export const api = {
  getSystemStatus: () => window.aiOS.getSystemStatus() as Promise<StatusView>,
  ask: (prompt: string) => window.aiOS.ask(prompt) as Promise<AskResult>,
  runPlan: (taskId: string) => window.aiOS.runPlan(taskId) as Promise<{ ok: boolean; error?: string; detail?: string }>,
  confirmStep: (stepId: string, approved: boolean) =>
    window.aiOS.confirmStep(stepId, approved) as Promise<boolean>,
  cancelTask: (taskId: string) => window.aiOS.cancelTask(taskId) as Promise<boolean>,
  listTasks: () => window.aiOS.listTasks() as Promise<TaskSummaryView[]>,
  getTask: (taskId: string) => window.aiOS.getTask(taskId) as Promise<TaskDetailView | null>,
  auditExplore: (cursor?: number, limit?: number) =>
    window.aiOS.auditExplore(cursor, limit) as Promise<AuditEntryView[]>,
  auditVerify: () => window.aiOS.auditVerify() as Promise<ChainStatusView>,
  listPermissions: () => window.aiOS.listPermissions() as Promise<PermissionView[]>,
  upsertPermission: (rule: string, result: string) =>
    window.aiOS.upsertPermission(rule, result) as Promise<unknown>,
  deletePermission: (rule: string) => window.aiOS.deletePermission(rule) as Promise<unknown>,
  settingsGet: () => window.aiOS.getSettings() as Promise<Record<string, unknown>>,
  memoriesList: () => window.aiOS.memoriesList() as Promise<
    Array<{ id: string; content: string; source: string; created_at: string }>
  >,
  memoriesAdd: (content: string) => window.aiOS.memoriesAdd(content) as Promise<{ ok: boolean }>,
  memoriesDelete: (id: string) => window.aiOS.memoriesDelete(id) as Promise<{ ok: boolean }>,
  setSecret: (secret: string) => window.aiOS.setSecret(secret) as Promise<unknown>,
  aiHealth: () => window.aiOS.aiHealth() as Promise<Record<string, unknown>>,
  aiChat: (prompt: string) => window.aiOS.aiChat(prompt) as Promise<{ text?: string; error?: string }>,
  onEngine: (cb: (event: unknown) => void) => {
    return window.aiOS.onEngine(cb);
  },
};

export type { EngineEvent, StatusView, ExecutionPlanLLM };
