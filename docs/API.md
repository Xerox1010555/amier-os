# Jarvis OS — API Reference (AI Orchestrator v1)

Base URL (local default): `http://127.0.0.1:8000` · Auth: `X-Jarvis-Secret: <secret>`
(Bearer also accepted) · Errors: `application/problem+json` (RFC-7807) with `code`:
`E_FORBIDDEN, E_RATE_LIMIT, E_BAD_REQUEST, E_NOT_FOUND, E_TIMEOUT, E_NO_KEY,
E_PROVIDER_DOWN, E_PROVIDER_ERROR, E_PLAN_INVALID, E_INTERNAL`.

## POST /api/v1/plan
Natural language → validated plan.
```json
{ "prompt": "list downloads folder contents", "context": {"os": "windows"}, "persona": "default" }
```
200 →
```json
{ "task_id": "uuid", "provider": "mock", "model": "mock-1",
  "steps": [ { "description": "…", "command": "rmdir /s /q …", "llm_risk_level": "high",
               "llm_requires_confirmation": true, "rationale": "…" } ] }
```
Notes: risk fields are **advisory** (`llm_` prefix); ≤ `JARVIS_MAX_STEPS_PER_PLAN` steps;
empty steps ⇒ `E_PLAN_REFUSED` (planner declined on policy grounds).

## POST /api/v1/critique
```json
{ "prompt": "…", "plan": { "task_id": "…", "steps": […] } }
```
200 → `{ "ok": true, "confidence": 0.0–1.0, "flags": ["…"], "corrected_plan": null | plan }`
Soft-fails open (`flag: critic_unavailable:<code>`) when the provider errors.

## POST /api/v1/explain
```json
{ "plan": {…} }
```
200 → `{ "explanation": "plain-language walkthrough (≤120 words)" }`
Deterministic fallback when the provider is unreachable.

## POST /api/v1/chat  (SSE)
```json
{ "prompt": "hello", "history": [ {"role":"user|assistant","content":"…"} ] }
```
Response stream (`text/event-stream`): events `meta`, `delta` (`{"text": chunk}`),
`error` (`{"code","detail"}`), `done`.

## POST /api/v1/summarize
```json
{ "events": [ {"task_id":"…","prompt":"…","status":"completed","steps":2,"denied":0} ] }
```
200 → `{ "summary": "≤120 words", "highlights": ["…"], "risk_notes": ["…"] }`

## GET /api/v1/health
200 → `{ "status":"online", "version":"1.0.0", "provider":"mock|openai|…",
"model":"…", "feature_flags": {...}, "auth_required": true }`

## GET /metrics
Prometheus text format (no auth path dependency): `jarvis_requests_total`,
`jarvis_plans_total`, `jarvis_provider_latency_seconds`, `jarvis_steps_per_plan`,
`jarvis_rate_limited_total`, `jarvis_build_info`.

---
## Desktop ⇄ Engine (NAPI reference)

`initialize_core(db?) · classify_risk(cmd, llm?) · get_status ·
execute_task(task_id, prompt, plan_json) · approve_step(step_id, ok) ·
cancel_task(task_id) · list_tasks · get_task(task_id) · get_audit_trail(cursor?, limit?) ·
verify_audit_chain · permissions: list/upsert(rule, result)/delete(rule) ·
register_event_listener(tsfn) · poll_events(cursor) · event_head ·
get_deny_explanation(cmd)`

## Desktop ⇄ Renderer (IPC, whitelist)

`ask · runPlan · confirmStep · getSystemStatus · tasks.list/get/cancel ·
audit.explore/verify · permissions.list/upsert/delete · memories.list/add/delete ·
settings.get/set · vault.has/set · ai.health · ai.chat` + push channel `engine:event`.
