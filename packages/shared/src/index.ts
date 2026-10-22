export type RiskLevel = "low" | "medium" | "high" | "deny";

export const RISK_ORDER: Record<RiskLevel, number> = {
  deny: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Adversarial merge: the stricter level always wins. */
export function stricterRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export interface TaskStepLLM {
  description: string;
  command: string;
  llm_risk_level: RiskLevel;
  llm_requires_confirmation: boolean;
  rationale?: string | null;
}

export interface ExecutionPlanLLM {
  task_id: string;
  provider: string;
  model: string | null;
  steps: TaskStepLLM[];
}

export interface EngineStepView {
  step_id: string;
  idx: number;
  description: string;
  command: string;
  /** Authoritative (never the model's) */
  risk_level: RiskLevel;
  llm_risk_level: string;
  risk_source: string;
  requires_confirmation: boolean;
  status: string;
  exit_code: number | null;
  timed_out: boolean;
}

export interface TaskSummaryView {
  task_id: string;
  user_prompt: string;
  status: string;
  created_at: string;
  steps_total: number;
  steps_done: number;
  steps_denied: number;
}

export interface TaskDetailView {
  summary: TaskSummaryView;
  plan_json: string;
  steps: EngineStepView[];
}

export interface StatusView {
  version: string;
  engine_ready: boolean;
  db_ok: boolean;
  rules_count: number;
  active_tasks: number;
  decisions_waiting: number;
}

export type EngineEventType =
  | "engine_ready"
  | "task_started"
  | "task_done"
  | "step_started"
  | "step_done"
  | "step_denied"
  | "security_alert"
  | "awaiting_confirmation"
  | "cancelled";

export interface EngineEvent<P = Record<string, unknown>> {
  event_type: EngineEventType;
  task_id: string | null;
  step_id: string | null;
  payload: P;
}

export interface AuditEntryView {
  seq: number;
  ts: string;
  kind: string;
  hash: string;
  payload: string;
}

export interface ChainStatusView {
  intact: boolean;
  broken_at: number | null;
  last_hash: string | null;
  entries: number;
}

export interface PermissionView {
  id: number;
  rule: string;
  result: "allow" | "require_confirm" | "deny";
  updated_at: string;
}

export interface MemoryView {
  id: string;
  content: string;
  source: string;
  created_at: string;
}

/** RFC-7807 problem+json, mirrored from services/ai-orchestrator/problems.py */
export interface ProblemDoc {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string | null;
  instance: string;
}

// ───────────────────────────── IPC contract ────────────────────────────────

/**
 * Every channel the renderer may invoke. The preload whitelist and the
 * main-process handlers are generated from this array; a startup self-test
 * refuses to boot on any mismatch (anti-regression rule #3).
 */
export const IPC_METHODS = [
  "ask",
  "confirmStep",
  "getSystemStatus",
  "runPlan",
  "tasks.list",
  "tasks.get",
  "tasks.cancel",
  "audit.explore",
  "audit.verify",
  "permissions.list",
  "permissions.upsert",
  "permissions.delete",
  "memories.list",
  "memories.add",
  "memories.delete",
  "settings.get",
  "settings.set",
  "vault.has",
  "vault.set",
  "ai.health",
  "ai.chat",
  "window.minimize",
  "window.maximize",
  "window.close",
] as const;

export type IpcMethod = (typeof IPC_METHODS)[number];

export const IPC_EVENT_CHANNEL = "engine:event";

export function isIpcMethod(channel: string): channel is IpcMethod {
  return (IPC_METHODS as readonly string[]).includes(channel);
}

export const SETTINGS_KEYS = [
  "provider",
  "model",
  "theme",
  "language",
  "hotkey",
  "telemetry",
  "spend_cap",
  "api_base",
] as const;

export type SettingKey = (typeof SETTINGS_KEYS)[number];
