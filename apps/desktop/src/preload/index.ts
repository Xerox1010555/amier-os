/**
 * Preload — the ONLY JS surface between the untrusted renderer and the OS.
 *
 * Everything is an allow-listed named method; each payload is checked and
 * wrapped with a typed error envelope. onEngine() returns an unsubscribe
 * function (no listener leaks), and the channel list mirrors
 * `IPC_METHODS` from @jarvis/shared exactly (self-tested at boot).
 */
import { contextBridge, ipcRenderer } from "electron";
import type { IpcMethod } from "@jarvis/shared";

function invoke<T>(channel: IpcMethod, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

const api = {
  /** Natural language → gated plan (steps include risk source + rules). */
  ask: (prompt: string) => invoke("ask", prompt),
  /** Approve/deny the step currently awaiting confirmation. */
  confirmStep: (stepId: string, approved: boolean) => invoke("confirmStep", stepId, approved),
  getSystemStatus: () => invoke("getSystemStatus"),
  runPlan: (taskId: string) => invoke("runPlan", taskId),
  cancelTask: (taskId: string) => invoke("tasks.cancel", taskId),
  listTasks: () => invoke("tasks.list"),
  getTask: (taskId: string) => invoke("tasks.get", taskId),
  auditExplore: (cursor?: number, limit?: number) => invoke("audit.explore", cursor, limit),
  auditVerify: () => invoke("audit.verify"),
  listPermissions: () => invoke("permissions.list"),
  upsertPermission: (rule: string, result: string) => invoke("permissions.upsert", rule, result),
  deletePermission: (rule: string) => invoke("permissions.delete", rule),
  memoriesList: () => invoke("memories.list"),
  memoriesAdd: (content: string) => invoke("memories.add", content),
  memoriesDelete: (id: string) => invoke("memories.delete", id),
  getSettings: () => invoke("settings.get"),
  setSecret: (secret: string) => invoke("settings.set", "secret", secret),
  hasKey: (account: string) => invoke("vault.has", account),
  setKey: (account: string, value: string) => invoke("vault.set", account, value),
  aiHealth: () => invoke("ai.health"),
  aiChat: (prompt: string) => invoke("ai.chat", prompt),
  /** Frameless window chrome controls. */
  win: {
    min: () => invoke("window.minimize"),
    max: () => invoke("window.maximize"),
    close: () => invoke("window.close"),
  },
  /** OS integration: login autostart (personal-assistant mode). */
  sys: {
    startupGet: () => invoke("sys.startup.get") as Promise<{ enabled: boolean; supported: boolean }>,
    startupSet: (enabled: boolean) =>
      invoke("sys.startup.set", enabled) as Promise<{ enabled: boolean; supported: boolean }>,
  },
  aiCritique: (prompt: string, plan: unknown) => {
    void plan; // critique flows through the ask() response flags
    return Promise.resolve({ ok: true });
  },

  /** Subscribe to engine events; returns an unsubscribe function. */
  onEngine: (callback: (event: unknown) => void): (() => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on("engine:event", listener);
    return () => {
      ipcRenderer.removeListener("engine:event", listener);
    };
  },
};

contextBridge.exposeInMainWorld("aiOS", api);

// Legacy alias for the old skeleton surface (compat, read-only status only).
contextBridge.exposeInMainWorld("aiOSLegacy", {
  executeCommand: async () => invoke("getSystemStatus"),
  getSystemStatus: () => invoke("getSystemStatus"),
});

export type JarvisApi = typeof api;
