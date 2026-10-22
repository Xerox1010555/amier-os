# Jarvis OS — Product Requirements Document (PRD)

**Version:** 1.0.0 · **Status:** implemented (v1 scope) · **Owner:** YAR

## 1. Vision

A privacy-first **AI Operating System Assistant** that lives on the user's machine,
understands natural-language requests about their device ("clean up my Downloads",
"show me what's eating CPU", "commit and push this project"), and executes them —
**only** after a deterministic, auditable security pipeline approves each step.

The system has one inviolable design law:

> **The LLM proposes. The rules engine decides. The human confirms. The audit log remembers.**

## 2. Users

| Persona | Needs |
|---|---|
| Local power user (primary) | Safe automation of everyday tasks; full control and visibility |
| Developer | Git/project chores, package installs, quick diagnostics |
| Privacy-sensitive professional | Nothing leaves the machine except the prompt to the chosen LLM provider |

## 3. Core user journeys (v1 — all implemented)

1. **Command (⌘K):** user types a request → orchestrator returns a validated plan →
   every step is risk-classified by the Rust rules engine → user reviews →
   Run → streaming step events → results + audit trail.
2. **Confirmation gate:** any step classified `medium`/`high` (or flagged by the
   model, or by the ruleset) pauses with a modal; Approve/Deny recorded in the DB.
3. **History:** every task, its steps, exit codes, denials, and timeouts are queryable.
4. **Security center:** tamper-evident audit-chain verification (1-click),
   permission overlay (allow/require_confirm/deny), full audit log.
5. **Dashboard:** today's tasks, completion and blocked counts at a glance.

## 4. Non-goals (v1)

- Generic shell RL agent / auto-everything execution (the confirmation gate is a feature).
- Multi-machine fleet management (k8s supports the *service*, never *device control*).
- Browser-embedded automation (roadmap §7.3).

## 5. Functional requirements (v1)

- FR1 Natural-language planning with provider-agnostic backend (openai / anthropic / gemini / ollama / mock).
- FR2 Plan validation: ≤6 steps, schema-validated, refute-on-empty steps (refusal → user-visible reason).
- FR3 Deterministic classification: ~40 regex rules over Windows cmd/POSIX/PowerShell surface;
  severity ladder `low→medium→high→deny`; **unknown ⇒ medium + confirm** (fail-closed default).
- FR4 Advisory merge: `stricter_of(rules, llm)`; the model can never de-escalate; `llm:deny` is absolute.
- FR5 Sandboxed execution: piped stdout/stderr, env scrubbed of `*KEY*|*TOKEN*|*SECRET*|AWS_*`,
  per-risk timeouts (30/120/300s), cancel flag, max 8 concurrent tasks, output capped.
- FR6 Hash-chained audit log (genesis anchor, SHA-256 `prev||ts||kind||payload`),
  1-click tamper check reporting the first broken sequence.
- FR7 Persistence: SQLite (WAL) owned by the Rust core: tasks, steps, executions,
  approvals, audit, permissions, settings, memories, artifacts.
- FR8 Live UI streaming of step events (ThreadsafeFunction push + cursor-poll fallback).
- FR9 i18n EN/AR with RTL.
- FR10 Service hardening: auth (X-Jarvis-Secret, constant-time), RFC-7807 problem+json,
  rate limiting, security headers, structured JSON logs with redaction, Prom metrics.

## 6. Quality attributes

- **Safety** — fail-closed; deny-list executions impossible (policy + engine).
- **Privacy** — command/output redaction at two layers (Rust + Python); secrets to OS keychain.
- **Reliability** — engine degrade (stub) never bricks the UI; service soft-failures (critic, summarizer).
- **Testability** — 21 offline pytest suites; unit-testable Rust rules/audit/sandbox (cargo test).

## 7. Success metrics

- Zero unauthorized executions (audit chain fully intact at all times).
- ≥80% of everyday requests produce a working plan with ≤2 clarification-free steps (mock provider guarantees determinism for CI).
- p95 provider latency visible in Grafana; 429s tracked per client identity.
