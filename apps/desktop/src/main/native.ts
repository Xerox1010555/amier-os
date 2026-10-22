/**
 * Loads the Rust NAPI engine. Graceful degradation: if the binary is missing
 * the app still boots with a stub that never executes anything (the UI shows
 * an "engine offline" banner instead of a crash — never a silent lie).
 */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { RiskLevel } from "@jarvis/shared";

export interface RustVerdict {
  risk_level: string;
  matched_rule: string | null;
  requires_confirmation: boolean;
}

export interface NativeEngine {
  engineReady: boolean;
  initializeCore(dbPath?: string): string;
  classifyRisk(command: string, llmRisk?: string): RustVerdict;
  getStatus(): {
    version: string;
    engine_ready: boolean;
    db_ok: boolean;
    rules_count: number;
    active_tasks: number;
    decisions_waiting: number;
  };
  executeTask(taskId: string, userPrompt: string, planJson: string): string;
  approveStep(stepId: string, approved: boolean): boolean;
  cancelTask(taskId: string): boolean;
  listTasks(): unknown[];
  getTask(taskId: string): unknown;
  getAuditTrail(cursor?: number, limit?: number): unknown[];
  verifyAuditChain(): unknown;
  upsertPermission(rule: string, result: string): boolean;
  deletePermission(rule: string): boolean;
  listPermissions(): unknown[];
  registerEventListener(cb: (ev: unknown) => void): string;
  pollEvents(cursor?: number): unknown[];
  eventHead(): number;
  getDenyExplanation?(command: string): string | null;
}

function candidatePaths(): string[] {
  const candidates: string[] = [];
  const envPath = process.env.JARVIS_CORE_PATH;
  if (envPath) candidates.push(envPath);
  const appRoot = app.getAppPath();
  candidates.push(
    path.join(appRoot, "core", "ai_os_core.node"), // dev & packaged extraResources
    path.join(process.resourcesPath ?? appRoot, "core", "ai_os_core.node"),
    path.join(appRoot, "index.node"),
  );
  return candidates;
}

function createStub(): NativeEngine {
  const stub = {
    engineReady: false,
    initializeCore: () => "engine offline (stub): build the Rust core via `npm run core:build`",
    classifyRisk: (command: string, llmRisk?: string) => {
      // Fail-safe default when no engine exists: treat as medium+confirm.
      void command; void llmRisk;
      return { risk_level: "medium", matched_rule: "stub:no-engine", requires_confirmation: true } as RustVerdict;
    },
    getStatus: () => ({
      version: "1.0.0",
      engine_ready: false,
      db_ok: false,
      rules_count: 0,
      active_tasks: 0,
      decisions_waiting: 0,
    }),
    executeTask: () => {
      throw new Error("engine offline: execution disabled");
    },
    approveStep: () => false,
    cancelTask: () => false,
    listTasks: () => [],
    getTask: () => null,
    getAuditTrail: () => [],
    verifyAuditChain: () => ({ intact: false, entries: 0, last_hash: null, broken_at: null }),
    upsertPermission: () => false,
    deletePermission: () => false,
    listPermissions: () => [],
    registerEventListener: () => "offline",
    pollEvents: () => [],
    eventHead: () => 0,
  };
  return stub as unknown as NativeEngine;
}

export function loadNative(): NativeEngine {
  for (const candidate of candidatePaths()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const mod = require(candidate) as Partial<NativeEngine>;
      if (mod && typeof mod.initializeCore === "function") {
        if (typeof (mod as NodeJS.Module).exports === "function") {
          // Legacy output shape guard.
          continue;
        }
        const engine = mod as NativeEngine;
        engine.engineReady = true;
        return engine;
      }
    } catch (err) {
      console.warn(`[native] failed to load engine candidate: ${candidate}`, err);
    }
  }
  return createStub();
}

/** Local DB path resolution (user data dir by default). */
export function resolveDbPath(): { dbPath: string; dbDir: string } {
  const override = process.env.JARVIS_DB;
  if (override && override.trim()) {
    return { dbPath: override, dbDir: path.dirname(override) };
  }
  const dbDir = path.join(app.getPath("userData"), "jarvis");
  return { dbPath: path.join(dbDir, "jarvis.db"), dbDir };
}
