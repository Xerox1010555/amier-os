/**
 * Typed client for the local AI orchestrator service.
 * Calls happen ONLY from the main process; the renderer flows over IPC.
 */
import { vault } from "./vault";
import type { ExecutionPlanLLM } from "@jarvis/shared";

export interface AiHealth {
  status: string;
  version: string;
  provider: string;
  model: string | null;
  auth_required: boolean;
}

export function aiBase(): string {
  return (process.env.JARVIS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

const SECRET_ACCOUNT = "jarvis:shared-secret";

export async function withSecretHeaders(): Promise<Record<string, string>> {
  const envSecret = process.env.JARVIS_SHARED_SECRET;
  const secret = envSecret && envSecret.trim() ? envSecret : (await vault.get(SECRET_ACCOUNT)) ?? "";
  return secret ? { "X-Jarvis-Secret": secret } : {};
}

export async function aiHealth(): Promise<AiHealth | { error: string }> {
  try {
    const res = await fetch(`${aiBase()}/api/v1/health`, { headers: await withSecretHeaders() });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return (await res.json()) as AiHealth;
  } catch (err) {
    return { error: String(err) };
  }
}

export async function askPlan(prompt: string): Promise<ExecutionPlanLLM | { problem: unknown; status: number }> {
  const res = await fetch(`${aiBase()}/api/v1/plan`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await withSecretHeaders()) },
    // Note: the user prompt passes through unmodified; validation & redaction
    // happen server-side (RFC-7807 problem docs on failure).
    body: JSON.stringify({ prompt }),
  });
  const body = await res.json();
  if (!res.ok) return { problem: body, status: res.status };
  return body as ExecutionPlanLLM;
}

export async function critiquePlan(prompt: string, plan: ExecutionPlanLLM): Promise<unknown> {
  const res = await fetch(`${aiBase()}/api/v1/critique`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await withSecretHeaders()) },
    body: JSON.stringify({ prompt, plan }),
  });
  return res.json();
}

/** Parse a minimal SSE stream from the chat endpoint. */
export async function streamChat(
  prompt: string,
  onDelta: (text: string) => void,
): Promise<void> {
  const res = await fetch(`${aiBase()}/api/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await withSecretHeaders()) },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok || !res.body) {
    onDelta(`[chat error: HTTP ${res.status}]`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const payload = JSON.parse(dataLine.slice(5).trim());
        if (payload.text) onDelta(String(payload.text));
      } catch {
        /* ignore malformed chunk */
      }
    }
  }
}
