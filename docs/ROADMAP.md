# Amier OS — Roadmap

## v1.0.0 (shipped in this repo)
- [x] Rust kernel: rules (deny/high/medium/low + fail-closed default), sandboxed
      threaded executor, hash-chained audit, SQLite WAL persistence, NAPI bridge,
      cancellation, approvals condvar, max 8 tasks, redaction.
- [x] Orchestrator: plan/critique/chat-SSE/explain/summarize/health/metrics,
      provider-agnostic (openai/anthropic/gemini/ollama/mock), RFC-7807, rate limit,
      structured redacting logs, 21 offline tests.
- [x] Desktop: hardened Electron shell (CSP, sandbox, deny-permissions, tray,
      single-instance, self-tested IPC contract), React UI (dashboard, command ⌘K,
      history, security center, memory, settings), EN/AR i18n, design system.
- [x] Infra: docker compose dev stack, k8s deployment/service/hpa, Prometheus,
      provisioned Grafana, CI (python+ts+rust), release workflow (3-OS desktop builds).

## v1.1 — Execution ergonomics
- [ ] True renderer streaming for step output chunks (delta events instead of previews)
- [ ] Retry-failed-step button (engine: re-run single step by id)
- [ ] Plan amendment loop: critic's `corrected_plan` auto-wires into the gate (v1 shows flags)
- [ ] File artifacts panel (artifacts table → file cards with SHA-256)

## v1.2 — Memory & context
- [ ] Rust-side `memories` CRUD endpoints + renderer wiring (table exists since v1)
- [ ] SQLite-FTS5 semantic-ish search over memories/audit
- [ ] Conversation memory for planning (multiple turns risk-checked)

## v2 — Multi-pilot & fleets
- [ ] Multiple projects/workspaces (per-repo rules overlays)
- [ ] Policy packs (importable JSON rule bundles + signature verification)
- [ ] Team dashboards (local agents report to self-hosted orchestrator)
- [ ] Browser automation module with same gate/audit pipeline

## Engineering backlog
- [ ] Property-based tests for the rules classifier (fuzz corpus in CI)
- [ ] Warm electron-updater signing certificates + delta updates
- [ ] Opentelemetry tracing across Electron ↔ service boundaries
- [ ] Performance: engine event coalescing for very chatty tasks
