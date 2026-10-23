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
  if (!app.isPackaged) {
    // dev from apps/desktop → monorepo-root core build
    candidates.push(path.join(appRoot, "..", "..", "core", "ai_os_core.node"));
  }
  return candidates;
}

/** napi-rs returns camelCase struct fields; normalize to the snake_case contract. */
function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = snakeKeys(val);
    }
    return out;
  }
  return value;
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
        // napi-rs v2 marshals #[napi(object)] fields as camelCase; the renderer
        // contract is snake_case — normalize once at this boundary.
        const raw = engine as unknown as Record<string, unknown>;
        const need = (fn: unknown, name: string): ((...args: unknown[]) => unknown) => {
          if (typeof fn !== "function") throw new TypeError(`engine API missing: ${name}`);
          return fn as (...args: unknown[]) => unknown;
        };
        const classifyRaw = need(raw.classifyRisk, "classifyRisk");
        engine.classifyRisk = (command: string, llmRisk?: string) =>
          snakeKeys(classifyRaw(command, llmRisk)) as RustVerdict;
        const statusRaw = need(raw.getStatus, "getStatus");
        engine.getStatus = () =>
          snakeKeys(statusRaw()) as ReturnType<NativeEngine["getStatus"]>;
        const pollRaw = need(raw.pollEvents, "pollEvents");
        engine.pollEvents = (cursor?: number) =>
          snakeKeys(pollRaw(cursor)) as unknown[];
        const listTasksRaw = need(raw.listTasks, "listTasks");
        engine.listTasks = () => snakeKeys(listTasksRaw()) as unknown[];
        const getTaskRaw = need(raw.getTask, "getTask");
        engine.getTask = (taskId: string) => snakeKeys(getTaskRaw(taskId)) as unknown;
        const trailRaw = need(raw.getAuditTrail, "getAuditTrail");
        engine.getAuditTrail = (cursor?: number, limit?: number) =>
          snakeKeys(trailRaw(cursor, limit)) as unknown[];
        const verifyRaw = need(raw.verifyAuditChain, "verifyAuditChain");
        engine.verifyAuditChain = () => snakeKeys(verifyRaw()) as unknown;
        const permsRaw = need(raw.listPermissions, "listPermissions");
        engine.listPermissions = () => snakeKeys(permsRaw()) as unknown[];
        const listenRaw = need(raw.registerEventListener, "registerEventListener");
        engine.registerEventListener = (cb: (ev: unknown) => void) =>
          listenRaw((ev: unknown) => cb(snakeKeys(ev))) as string;
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
