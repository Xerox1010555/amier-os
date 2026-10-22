# Jarvis OS — Architecture

## 1. System map

```
┌─────────────────────────────── Windows/macOS/Linux device ───────────────────────────────┐
│                                                                                          │
│  Electron 31 (apps/desktop)                                                              │
│  ┌────────────┐  IPC (allow-list)  ┌─────────────┐   NAPI (napi-rs)   ┌────────────────┐  │
│  │  Renderer  │◄──────────────────►│ Main (Node) │◄──────────────────►│ Rust core      │  │
│  │  React 18  │   contextBridge    │  + vault    │  ai_os_core.node   │ (core/)        │  │
│  │  zustand   │   only             │  + AI client│                    │ rules · engine │  │
│  └────────────┘                    └──────┬──────┘                    │ audit · sqlite │  │
│        ▲ sandbox: no node, CSP            │                           └───────┬────────┘  │
│        │ engine:event (push)              │ https (127.0.0.1)                 │           │
│        └──────────────────────────────────┴───────────────┐                 ▼           │
│                                            ┌──────────────▼─────────────┐ SQLite WAL   │
│                                            │ FastAPI orchestrator       │ (single dir) │
│                                            │ (services/ai-orchestrator) │              │
│                                            │ plan · critique · chat SSE │              │
│                                            │ explain · summarize        │              │
│                                            └──────────────┬─────────────┘              │
│                                                           │ httpx                      │
│                                                     ┌─────▼──────┐                     │
│                                                     │ LLM vendor │ (openai/anthropic/  │
│                                                     │  REST API  │  gemini/ollama)     │
│                                                     └────────────┘                     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Ownership:** the SQLite database has exactly one writer: the Rust engine. The
desktop renderer and the Python service never touch it directly.

## 2. Layers & directories

| Path | Layer | Notes |
|---|---|---|
| `apps/desktop/src/main` | Electron main (TS, CommonJS→`dist-electron`) | native loader, IPC registry + self-test, security gate, vault, tray |
| `apps/desktop/src/preload` | Bridge | `contextBridge` whitelist; `onEngine()` returns unsubscribe |
| `apps/desktop/src/renderer` | UI (React 18, Vite, strict TS) | zustand store, design-system CSS, i18n EN/AR |
| `packages/shared` | Contract | `IPC_METHODS` (single source of truth), view types, `stricterRisk` |
| `core/` | Rust NAPI kernel | see §3 |
| `services/ai-orchestrator` | FastAPI (pydantic v2) | agents + providers + hardening; no SDK deps (httpx) |
| `services/monitoring` | Observability | Prometheus scrape config, provisioned Grafana dashboard |
| `infrastructure/{docker,k8s}` | Deployment | compose dev stack, k8s deployment/service/hpa (service only) |

## 3. Rust core (core/)

- **`security/rules.rs`** — ~40 static regex rules, severity ladder, `classify(cmd, llm_risk)`
  implementing `stricter_of` merge and honoring `llm:deny`. Default (unclassified) =
  `medium` + confirm. Unit tests assert: rules compile 1:1, deny/high/medium/low buckets,
  model-cannot-deescalate.
- **`security/secrets.rs`** — redaction (sk-/ghp_/xoxb/AKIA/AIza/portfolio JWTs/bearer/
  password kv/email/private-key + entropy heuristic) + SHA-256 helper.
- **`security/sandbox.rs`** — platform spawn spec (`cmd /C` | `sh -c`), env scrub,
  output caps, timeouts per risk.
- **`audit/mod.rs`** — hash-chained log `SHA256(prev||ts||kind||payload)`, genesis anchor,
  streaming verify returning the first broken `seq`.
- **`db/mod.rs`** — rusqlite (bundled), WAL, FK ON, embedded migration
  `migrations/0001_init.sql` (tasks, task_steps, step_executions, approvals, audit_log,
  permissions, artifacts, memories, settings).
- **`engine/mod.rs`** — `Shared` state (`Mutex<Repo>` because `rusqlite::Connection`
  is Send-but-not-Sync), `EventSink` (ring buffer + optional ThreadsafeFunction push +
  cursor poll), `Approvals` (Condvar, cancel-aware, fail-closed on timeouts),
  worker-thread per task (max 8), per-step pipeline:
  classify → persist risk → deny? → confirm? (condvar) → sandboxed run
  (streaming readers, wait_timeout, kill on timeout/cancel) → persist execution → emit → audit.
- **`bridge/mod.rs`** — the `#[napi]` surface: `initialize_core(db?)`,
  `classify_risk`, `get_status`, `execute_task(task_id, prompt, plan_json)`,
  `approve_step`, `cancel_task`, `list_tasks`, `get_task`, `get_audit_trail`,
  `verify_audit_chain`, `permissions.{list,upsert,delete}`, `register_event_listener`,
  `poll_events(cursor)`, `event_head`, `get_deny_explanation`.

## 4. Event flow

```
engine worker thread ──emit──► EventSink ──► TSFN (push to Electron main)
                                  │                └─► win.webContents.send("engine:event", …)
                                  └─► ring buffer (5000) ──► poll_events(cursor) fallback
```

Renderer store ingests: `task_started, step_started, awaiting_confirmation, step_done,
step_denied (reason \| security_alert), task_done`.

## 5. Security invariants (implemented)

1. Renderer is untrusted: `contextIsolation: true`, `nodeIntegration: false`,
   `sandbox: true`, CSP headers, deny-all permission handler, no devtools in prod.
2. IPC has a closed whitelist (`IPC_METHODS`); boot self-test quits on mismatch.
3. Plans pass through the **security gate** (rules ⊕ advisory, stricter wins) in main;
   the renderer never sends JSON to the engine — only `task_id`s of cached plans.
4. `deny` steps never spawn a process; they produce a `security_alert` + `step_denied`
   + audit entry and are skipped with `status=denied`.
5. Both layers (Rust + Python) redact secrets independently (defense in depth).
6. Every state mutation lands in the hash-chained audit log.

## 6. Service design

- **Provider-agnostic** via direct REST (httpx) — `openai`, `anthropic`, `gemini`,
  `ollama` (local, offline), `mock` (deterministic CI/offline).
- **Agents**: Planner (policy prompt + JSON repair + pydantic validation + truncation),
  Critic (adversarial reviewer; soft-fails open), Summarizer (activity digests).
- **Hardening**: shared-secret auth (constant-time), RFC-7807 problem+json everywhere,
  token-bucket rate limit (IP/token hashed identity), security headers, request-id
  correlation, JSON logs with redaction filter, Prometheus metrics
  (`jarvis_requests_total`, `jarvis_plans_total`, `jarvis_provider_latency_seconds`,
  `jarvis_steps_per_plan`, `jarvis_rate_limited_total`).

## 7. Known deviations from the original master prompt

| Master prompt said | Shipped | Why |
|---|---|---|
| sqlx (async Rust) | rusqlite (bundled) | sync engine design; avoids async-runtime/threading hazards; same SQLite/WAL |
| langchain | direct httpx REST providers | lean, fully controllable, offline-friendly (ollama), easier CI |
| Tailwind + framer-motion | hand-rolled CSS design system, CSS keyframes | zero-config resilient builds; same visual quality |
| pnpm | npm workspaces | universal on Windows; same workspace semantics |
| keytar only | keytar + AES-256-GCM file fallback | app must boot even without native keytool chain |
