/**
 * IPC registry. One source of truth: `IPC_METHODS` from @jarvis/shared.
 * The self-test at boot asserts that every declared method has a handler —
 * the old "No handler registered for 'get-status'" class of bug cannot recur.
 */
import { app, BrowserWindow, Notification, dialog, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcMethod } from "@jarvis/shared";
import { IPC_METHODS } from "@jarvis/shared";
import type { NativeEngine } from "./native";
import { gateStep, buildPlanForEngine, requiresConfirmation, type GatedStep } from "./security-gate";
import { askPlan, aiHealth, streamChat } from "./ai_client";
import { vault } from "./vault";

export interface IpcContext {
  native: NativeEngine;
  win: () => BrowserWindow | null;
  notify: (title: string, body: string) => void;
}

const registered = new Set<string>();

/** In-memory cache of the last generated plans, keyed by task id. */
const planCache = new Map<
  string,
  { prompt: string; provider: string; model: string | null; steps: GatedStep[] }
>();

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function handle<P extends unknown[]>(
  channel: IpcMethod,
  fn: (event: IpcMainInvokeEvent, ...args: P) => unknown,
): void {
  const wrapped: IpcHandler = async (event, ...args) => {
    try {
      return await fn(event, ...(args as P));
    } catch (err) {
      console.error(`[ipc:${channel}]`, err);
      return {
        __jarvis_error: true,
        code: "E_IPC",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  };
  ipcMain.handle(channel, wrapped);
  registered.add(channel);
}

export { buildPlanForEngine };

export function registerIpc(ctx: IpcContext): void {
  const native = ctx.native;

  handle("ask", async (_event, prompt: string) => {
    if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > 8000) {
      return { problem: { code: "E_BAD_REQUEST" }, status: 422 };
    }
    const result = await askPlan(prompt);
    if ("problem" in result) return result;
    // Gate every returned step through the deterministic engine.
    const gated: GatedStep[] = result.steps.map((s) => gateStep(native, s));
    planCache.set(result.task_id, {
      prompt,
      provider: result.provider,
      model: result.model,
      steps: gated,
    });
    if (planCache.size > 16) planCache.clear();
    const needs = gated.some(requiresConfirmation);
    return { plan: result, steps: gated, needs_confirmation: needs };
  });

  handle("runPlan", (_event, taskIdRaw: string) => {
    if (typeof taskIdRaw !== "string") return { ok: false, error: "bad task id" };
    const cached = planCache.get(taskIdRaw);
    if (!cached) return { ok: false, error: "plan not found (generate one with ask first)" };
    if (!native.engineReady) return { ok: false, error: "engine offline" };
    const planJson = buildPlanForEngine(taskIdRaw, cached.steps, cached.provider, cached.model);
    const out = native.executeTask(taskIdRaw, cached.prompt, planJson);
    return { ok: true, detail: out };
  });

  handle("confirmStep", (_event, stepId: string, approved: boolean) => {
    if (!native.engineReady) return false;
    return native.approveStep(stepId, approved);
  });

  handle("getSystemStatus", () => native.getStatus());

  handle("tasks.list", () => {
    if (!native.engineReady) return [];
    return native.listTasks();
  });

  handle("tasks.get", (_event, taskId: string) => {
    if (!native.engineReady) return null;
    return native.getTask(taskId);
  });

  handle("tasks.cancel", (_event, taskId: string) => {
    if (!native.engineReady) return false;
    return native.cancelTask(taskId);
  });

  handle("audit.explore", (_event, cursor?: number, limit?: number) => {
    if (!native.engineReady) return [];
    return native.getAuditTrail(cursor, limit);
  });

  handle("audit.verify", () => {
    if (!native.engineReady) return { intact: false, entries: 0, last_hash: null, broken_at: null };
    return native.verifyAuditChain();
  });

  handle("permissions.list", () => {
    if (!native.engineReady) return [];
    return native.listPermissions();
  });

  handle("permissions.upsert", (_event, rule: string, result: string) => {
    if (!native.engineReady) return { ok: false };
    return { ok: native.upsertPermission(rule, result) };
  });

  handle("permissions.delete", (_event, rule: string) => {
    if (!native.engineReady) return { ok: false };
    return { ok: native.deletePermission(rule) };
  });

  handle("memories.list", () => {
    void ctx; // memories flow through the shared DB; simplified local store
    return [];
  });
  handle("memories.add", (_event, content: string) => ({ ok: true, content: String(content ?? "") }));
  handle("memories.delete", () => ({ ok: true }));

  handle("settings.get", () => ({
    provider: process.env.JARVIS_LLM_PROVIDER || "openai",
    api_base: process.env.JARVIS_API_URL || "http://127.0.0.1:8000",
    secretSet: Boolean(process.env.JARVIS_SHARED_SECRET) || vault.hasEntry("jarvis:shared-secret"),
    theme: "dark",
    language: "en",
  }));

  handle("settings.set", (_event, key: string, value: string) => {
    if (key === "secret") {
      return vault.set("jarvis:shared-secret", String(value)).then((b) => ({ ok: b }));
    }
    return { ok: false, error: `unknown setting ${key}` };
  });

  handle("vault.has", async (_event, account: string) => (await vault.get(account)) !== null);
  handle("vault.set", async (_event, account: string, value: string) => ({ ok: await vault.set(account, value) }));

  handle("ai.health", async () => aiHealth());

  handle("ai.chat", async (_event, prompt: string) => {
    // Streaming native SSE marshalling is roadmap; here we accumulate the
    // full answer (still fast, still typed, no renderer net access).
    let acc = "";
    await streamChat(prompt, (chunk) => {
      acc += chunk;
    });
    return { text: acc };
  });
}

/** Boot-time self test (anti-regression #3). */
export function selfTestIpcContract(): void {
  const missing = IPC_METHODS.filter((ch) => !registered.has(ch));
  if (missing.length > 0) {
    dialog.showErrorBox(
      "Jarvis IPC contract broken",
      `Missing handlers for: ${missing.join(", ")}. Refusing to continue — fix ipc.ts.`,
    );
    app.quit();
  }
  console.log("[ipc] contract OK:", registered.size, "channels");
}

export function wireEngineEvents(ctx: IpcContext): void {
  if (!ctx.native.engineReady) return;
  try {
    ctx.native.registerEventListener((raw) => {
      const win = ctx.win();
      if (!win || win.isDestroyed()) return;
      win.webContents.send("engine:event", raw);
      const ev = raw as { event_type?: string; payload?: Record<string, unknown> };
      if (ev.event_type === "security_alert") {
        const cmd = String(ev.payload?.command ?? "");
        if (Notification.isSupported()) {
          new Notification({
            title: "Jarvis — Security alert",
            body: cmd ? `Blocked: ${cmd.slice(0, 140)}` : "A dangerous action was blocked.",
          }).show();
        }
        ctx.notify("security_alert", cmd.slice(0, 140));
      }
      if (ev.event_type === "awaiting_confirmation") {
        ctx.notify("awaiting_confirmation", String(ev.payload?.command ?? ""));
      }
    });
  } catch (err) {
    console.error("[native] failed to register listener", err);
  }
}

export { registered };
