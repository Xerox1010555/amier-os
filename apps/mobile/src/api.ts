/**
 * Amier OS mobile API — talks to the AI orchestrator over HTTP.
 * The phone is a COMPANION: plans classified authoritatively on the desktop
 * kernel; everything here renders the service's (advisory) view + streams chat.
 */
const LS_SERVER = "amier.server";
const LS_SECRET = "amier.secret";

export interface Health {
  status: string;
  version: string;
  provider: string;
  model?: string | null;
  auth_required?: boolean;
}

export interface PlanStepLLM {
  description: string;
  command: string;
  llm_risk_level: string;
  llm_requires_confirmation: boolean;
  rationale?: string | null;
}

export interface Plan {
  task_id: string;
  provider: string;
  model?: string | null;
  steps: PlanStepLLM[];
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function getServer(): string {
  return localStorage.getItem(LS_SERVER) ?? "http://10.0.2.2:8000";
}
export function getSecret(): string {
  return localStorage.getItem(LS_SECRET) ?? "";
}
export function setServer(v: string): void {
  localStorage.setItem(LS_SERVER, v.replace(/\/+$/, ""));
}
export function setSecret(v: string): void {
  localStorage.setItem(LS_SECRET, v);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getServer()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(getSecret() ? { "X-Jarvis-Secret": getSecret() } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) throw new ApiError("E_AUTH", "Wrong or missing shared secret (Settings)");
  if (res.status === 429) throw new ApiError("E_RATE_LIMIT", "Rate limited — try again in a minute");
  if (!res.ok) {
    let code = "E_HTTP";
    let detail: string | null = null;
    try {
      const problem = (await res.json()) as { code?: string; detail?: string | null };
      code = problem.code ?? code;
      detail = problem.detail ?? null;
    } catch {
      /* non-problem body */
    }
    throw new ApiError(code, detail ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<Health>("/api/v1/health"),
  plan: (prompt: string) =>
    request<Plan>("/api/v1/plan", {
      method: "POST",
      body: JSON.stringify({ prompt, context: { os: "android", source: "mobile-companion" } }),
    }),
  /** Chat consumes SSE text/event-stream and yields incremental text. */
  chat(
    prompt: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return fetch(`${getServer()}/api/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(getSecret() ? { "X-Jarvis-Secret": getSecret() } : {}) },
      body: JSON.stringify({ prompt, history }),
      signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) throw new ApiError("E_STREAM", `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim()) as { text?: string };
            if (ev.text) onDelta(ev.text);
          } catch {
            /* keep-alive or malformed — ignore */
          }
        }
      }
    });
  },
};
